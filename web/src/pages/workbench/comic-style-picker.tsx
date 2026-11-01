import { Button, Input, Spin } from "antd";
import { Check, Image as ImageIcon, Palette, Pencil, Plus, RefreshCw, Save, Search, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { MediaPreview } from "@/components/media-preview";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Callout } from "@/components/ui/product/callout/callout";
import { COMIC_STYLE_PRESETS } from "@/lib/canvas/comic-style-presets";
import { validateComicStyleSelection } from "@/lib/canvas/comic-style";
import { createClientUUID } from "@/lib/client-id";
import { listComicStyles, saveComicStyle, uploadComicStyleImage, type ComicStyleLibraryItem } from "@/services/comic-styles";
import type { CanvasComicStyleSelection } from "@/types/canvas";
import "./comic-style-picker.css";

type StyleCard = {
    id: string;
    title: string;
    prompt: string;
    coverUrl?: string;
    referenceResourceId?: string;
    kind: "builtin" | "mine" | "current";
    revision?: number;
    disabledReason?: string;
};
type StyleEditor = {
    sessionId: string;
    contextKey: string;
    entityId?: string;
    expectedRevision?: number;
    title: string;
    prompt: string;
    coverUrl?: string;
    referenceResourceId?: string;
    copiedFromBuiltin: boolean;
};
type ComicStylePickerProps = {
    value: string;
    selection?: CanvasComicStyleSelection;
    onChange: (prompt: string, selection?: CanvasComicStyleSelection) => void;
    disabled: boolean;
    contextKey: string;
    referenceOnly?: boolean;
};

const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const safeCoverUrl = (url?: string) => {
    if (!url) return undefined;
    try { return validateComicStyleSelection({ id: "preview", title: "预览", coverUrl: url }).coverUrl; }
    catch { return undefined; }
};
const selectionFor = (card: Pick<StyleCard, "id" | "title" | "coverUrl" | "referenceResourceId">): CanvasComicStyleSelection => ({
    id: card.id, title: card.title,
    ...(card.coverUrl ? { coverUrl: card.coverUrl } : {}),
    ...(card.referenceResourceId ? { referenceResourceId: card.referenceResourceId } : {}),
});

export function ComicStylePicker({ value, selection, onChange, disabled, contextKey, referenceOnly = false }: ComicStylePickerProps) {
    const queryClient = useQueryClient();
    const [libraryState, setLibraryState] = useState<{ contextKey: string; items: ComicStyleLibraryItem[] }>({ contextKey, items: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);
    const [tab, setTab] = useState<"builtin" | "mine">("builtin");
    const [query, setQuery] = useState("");
    const [editor, setEditor] = useState<StyleEditor | null>(null);
    const [editorError, setEditorError] = useState("");
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const imageFileRef = useRef<HTMLInputElement>(null);
    const contextRef = useRef(contextKey);
    const editorRef = useRef(editor);
    const disabledRef = useRef(disabled);
    const mountedRef = useRef(true);
    const operationRef = useRef<string | null>(null);
    const libraryRequestRef = useRef(0);
    contextRef.current = contextKey;
    editorRef.current = editor;
    disabledRef.current = disabled;

    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    useEffect(() => {
        operationRef.current = null;
        setEditor(null); setEditorError(""); setUploading(false); setSaving(false); setError(""); setQuery(""); setTab("builtin");
    }, [contextKey]);
    useEffect(() => {
        let active = true;
        const requestId = ++libraryRequestRef.current;
        setLoading(true); setError("");
        void listComicStyles().then(items => {
            if (active && requestId === libraryRequestRef.current && contextRef.current === contextKey) setLibraryState({ contextKey, items });
        }).catch(cause => {
            if (active && requestId === libraryRequestRef.current && contextRef.current === contextKey) setError(messageOf(cause, "我的画风加载失败"));
        }).finally(() => { if (active && requestId === libraryRequestRef.current && contextRef.current === contextKey) setLoading(false); });
        return () => { active = false; };
    }, [contextKey, reload]);

    const library = libraryState.contextKey === contextKey ? libraryState.items : [];
    const cards = useMemo<StyleCard[]>(() => [
        ...COMIC_STYLE_PRESETS.map(preset => ({ ...preset, kind: "builtin" as const })),
        ...library.map(item => ({ ...item, kind: "mine" as const })),
    ], [library]);
    const selectedCard = cards.find(card => (referenceOnly ? Boolean(selection) : card.prompt === value) && (!selection || (
        card.id === selection.id && card.title === selection.title
        && (card.coverUrl || "") === (selection.coverUrl || "")
        && (card.referenceResourceId || "") === (selection.referenceResourceId || "")
    )));
    const currentCard: StyleCard | undefined = value.trim() && (!referenceOnly || selection) ? selectedCard || {
        id: selection?.id || "comic-current-style", title: selection?.title || "当前画风", prompt: value,
        coverUrl: selection?.coverUrl, referenceResourceId: selection?.referenceResourceId, kind: "current",
    } : undefined;
    const visibleCards = cards.filter(card => card.kind === tab && `${card.title} ${card.prompt}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const activeEditor = editor?.contextKey === contextKey ? editor : null;
    const currentCoverUrl = safeCoverUrl(currentCard?.coverUrl);
    const editorCoverUrl = safeCoverUrl(activeEditor?.coverUrl);
    const locked = disabled || saving || uploading;
    const validationError = !activeEditor?.title.trim() ? "请填写画风名称" : Array.from(activeEditor.title).length > 80 ? "画风名称最多 80 字" : !activeEditor.prompt.trim() ? "请填写画风描述" : Array.from(activeEditor.prompt).length > 1000 ? "画风描述最多 1000 字，请精简后保存" : "";
    const stillEditing = (draft: StyleEditor) => mountedRef.current && contextRef.current === draft.contextKey && editorRef.current?.sessionId === draft.sessionId;

    const openEditor = (card?: StyleCard) => {
        if (disabled || operationRef.current) return;
        setEditorError("");
        setEditor({
            sessionId: createClientUUID(), contextKey,
            ...(card?.kind === "mine" ? { entityId: card.id, expectedRevision: card.revision } : {}),
            title: card ? `${card.title}${card.kind === "builtin" ? " 副本" : ""}` : "",
            prompt: card?.prompt || "", coverUrl: card?.coverUrl, referenceResourceId: card?.referenceResourceId,
            copiedFromBuiltin: card?.kind === "builtin",
        });
    };
    const closeEditor = () => { if (!operationRef.current) { setEditor(null); setEditorError(""); } };
    const uploadImage = async (file?: File) => {
        if (!file || !activeEditor || locked || operationRef.current) return;
        const draft = activeEditor;
        operationRef.current = draft.sessionId;
        setUploading(true); setEditorError("");
        try {
            const image = await uploadComicStyleImage(file);
            if (!stillEditing(draft)) return;
            setEditor(current => current?.sessionId === draft.sessionId ? { ...current, ...image } : current);
        } catch (cause) { if (stillEditing(draft)) setEditorError(messageOf(cause, "画风图片上传失败，原有内容已保留")); }
        finally {
            if (operationRef.current === draft.sessionId) operationRef.current = null;
            if (stillEditing(draft)) setUploading(false);
        }
    };
    const saveEditor = async (apply: boolean) => {
        if (!activeEditor || locked || validationError || operationRef.current) return;
        const draft = activeEditor;
        operationRef.current = draft.sessionId;
        setSaving(true); setEditorError("");
        try {
            const saved = await saveComicStyle({ id: draft.entityId, expectedRevision: draft.expectedRevision, title: draft.title.trim(), prompt: draft.prompt.trim(), coverUrl: draft.coverUrl, referenceResourceId: draft.referenceResourceId });
            if (!stillEditing(draft)) return;
            libraryRequestRef.current += 1;
            setLoading(false); setError("");
            setLibraryState(current => ({ contextKey, items: [saved, ...(current.contextKey === contextKey ? current.items : []).filter(item => item.id !== saved.id)] }));
            void queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
            if (apply && (saved.disabledReason || disabledRef.current)) {
                setEditor(current => current?.sessionId === draft.sessionId ? { ...current, entityId: saved.id, expectedRevision: saved.revision, copiedFromBuiltin: false } : current);
                setEditorError(`画风已保存。${saved.disabledReason || "当前制作任务进行中，请稍后选择使用。"}`);
                return;
            }
            if (apply) onChange(saved.prompt, selectionFor(saved));
            setEditor(null); setTab("mine"); setQuery("");
        } catch (cause) { if (stillEditing(draft)) setEditorError(messageOf(cause, "画风未保存，编辑内容已保留")); }
        finally {
            if (operationRef.current === draft.sessionId) operationRef.current = null;
            if (mountedRef.current && contextRef.current === draft.contextKey) setSaving(false);
        }
    };
    const selectCard = (card: StyleCard) => {
        if (disabled || card.disabledReason) return;
        onChange(card.prompt, selectionFor(card));
    };

    return <section className="comic-style-picker" aria-label="漫画画风">
        {currentCard ? <div className="comic-style-current">
            <span className="comic-style-current-image">{currentCoverUrl ? <MediaPreview src={currentCoverUrl} kind="image" alt="" loading="lazy" /> : <Palette aria-hidden />}</span>
            <div><span className="comic-style-current-caption"><Check aria-hidden />当前画风</span><strong>{currentCard.title}</strong><p title={currentCard.prompt}>{currentCard.prompt}</p></div>
            <Button type="text" size="small" icon={<Pencil />} aria-label={`编辑当前画风：${currentCard.title}`} title="编辑当前画风" disabled={disabled} onClick={() => openEditor(currentCard)} />
        </div> : null}
        <div className="comic-style-library-tools"><SegmentedControl<"builtin" | "mine"> size="sm" value={tab} onChange={setTab} ariaLabel="画风来源" options={[{ value: "builtin", label: `预设 (${COMIC_STYLE_PRESETS.length})` }, { value: "mine", label: `我的 (${library.length})` }]} /><Input size="small" aria-label="搜索画风" placeholder="搜索画风" prefix={<Search />} allowClear value={query} onChange={event => setQuery(event.target.value)} /></div>
        {error ? <Callout tone="warning"><span>{error}</span><Button type="text" size="small" icon={<RefreshCw />} onClick={() => setReload(value => value + 1)}>重试</Button></Callout> : null}
        <div className="comic-style-grid" role="group" aria-label={tab === "builtin" ? "预设画风" : "我的画风"}>
            {tab === "mine" ? <button type="button" className="comic-style-add" disabled={disabled} onClick={() => openEditor()}><Plus aria-hidden /><span>新增画风</span></button> : null}
            {visibleCards.map(card => {
                const selected = selectedCard?.id === card.id && selectedCard.kind === card.kind;
                const coverUrl = safeCoverUrl(card.coverUrl);
                return <article className={`comic-style-card${selected ? " is-selected" : ""}`} key={`${card.kind}:${card.id}`}>
                    <button type="button" className="comic-style-card-select" aria-label={`选择画风：${card.title}`} aria-pressed={selected} disabled={disabled || Boolean(card.disabledReason)} title={card.disabledReason || card.title} onClick={() => selectCard(card)}>
                        <span className="comic-style-card-image">{coverUrl ? <MediaPreview src={coverUrl} kind="image" alt="" loading="lazy" fallbackLabel="暂无预览" /> : <span className="comic-style-card-empty"><Palette aria-hidden /><span>文字画风</span></span>}{selected ? <span className="comic-style-card-check"><Check aria-hidden /></span> : null}</span>
                        <span className="comic-style-card-name">{card.title}</span>
                    </button>
                    <button type="button" className="comic-style-card-edit" aria-label={`编辑画风：${card.title}`} title={card.kind === "builtin" ? "编辑并另存为我的画风" : "编辑画风"} disabled={disabled} onClick={() => openEditor(card)}><Pencil aria-hidden /><span>编辑</span></button>
                </article>;
            })}
            {!visibleCards.length ? <div className="comic-style-empty">{tab === "mine" && loading ? <><Spin size="small" /><span>正在载入我的画风</span></> : <><Palette aria-hidden /><span>{query ? "没有匹配的画风" : "还没有自定义画风"}</span></>}</div> : null}
        </div>
        <AppModal title={activeEditor?.entityId ? "编辑我的画风" : activeEditor?.copiedFromBuiltin ? "编辑画风副本" : "新增画风"} open={Boolean(activeEditor)} onCancel={closeEditor} closable={!saving && !uploading} maskClosable={!saving && !uploading} width="min(680px, calc(100vw - 32px))" footer={<><Button disabled={saving || uploading} onClick={closeEditor}>取消</Button><Button icon={<Save />} disabled={locked || Boolean(validationError)} loading={saving} onClick={() => void saveEditor(false)}>保存到我的画风</Button><Button type="primary" icon={<Check />} disabled={locked || Boolean(validationError)} loading={saving} onClick={() => void saveEditor(true)}>保存并使用</Button></>}>
            {activeEditor ? <div className="comic-style-editor">
                <label className="comic-style-field"><span>画风名称</span><Input aria-label="画风名称" maxLength={80} showCount value={activeEditor.title} disabled={locked} placeholder="例如：雨夜都市条漫" onChange={event => setEditor(current => current ? { ...current, title: event.target.value } : current)} /></label>
                <label className="comic-style-field"><span>画风描述</span><Input.TextArea aria-label="画风描述" maxLength={1000} showCount autoSize={{ minRows: 6, maxRows: 11 }} value={activeEditor.prompt} disabled={locked} placeholder="描述线条、配色、光影、材质与画面质感，避免写入具体人物和剧情。" onChange={event => setEditor(current => current ? { ...current, prompt: event.target.value } : current)} /></label>
                <div className="comic-style-image-editor"><div className="comic-style-upload-preview">{editorCoverUrl ? <MediaPreview src={editorCoverUrl} kind="image" alt="画风图片预览" /> : <ImageIcon aria-hidden />}</div><div className="comic-style-upload-copy"><strong>画风图片</strong><p>{activeEditor.referenceResourceId ? "开启统一画风时，这张图片会作为画风参考。" : activeEditor.coverUrl ? "当前为预览图。上传自己的图片后，可用于统一画风参考。" : "可上传 PNG、JPG 或 WebP，最大 20 MB。"}</p><div><Button icon={<Upload />} loading={uploading} disabled={locked} onClick={() => imageFileRef.current?.click()}>{activeEditor.coverUrl ? "更换图片" : "上传图片"}</Button>{activeEditor.coverUrl ? <Button type="text" icon={<X />} disabled={locked} onClick={() => setEditor(current => current ? { ...current, coverUrl: undefined, referenceResourceId: undefined } : current)}>移除</Button> : null}</div><p>图片仅约束画风，不用于复制其中的人物或构图；画风描述请手动填写。</p></div></div>
                {activeEditor.copiedFromBuiltin ? <p className="comic-style-editor-note">修改后保存为“我的画风”，保留原始预设。</p> : null}
                {editorError ? <Callout tone="error">{editorError}</Callout> : null}
            </div> : null}
        </AppModal>
        <input ref={imageFileRef} type="file" className="sr-only" aria-label="选择画风图片" accept="image/png,image/jpeg,image/webp" onChange={event => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    </section>;
}

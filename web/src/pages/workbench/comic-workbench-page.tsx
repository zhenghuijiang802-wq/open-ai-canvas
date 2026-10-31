import { Button, Input, Select, Spin } from "antd";
import { ArrowRight, BookOpen, ExternalLink, FileText, Image as ImageIcon, LoaderCircle, Plus, RefreshCw, Save, SlidersHorizontal, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { MediaPreview } from "@/components/media-preview";
import { ModelPicker } from "@/components/model-picker";
import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CanvasMediaVersionModal } from "@/components/canvas/canvas-media-version-modal";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Callout } from "@/components/ui/product/callout/callout";
import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { canvasThemes } from "@/lib/canvas-theme";
import { configuredModelDisplayName, mergedImageCapabilityConfig } from "@/lib/model-selection";
import { normalizeImageValue } from "@/lib/model-capabilities";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { type AiConfig } from "@/stores/use-config-store";
import { useComicWorkbench } from "./use-comic-workbench";
import { ComicImageCard } from "./comic-image-card";
import { ComicStylePicker } from "./comic-style-picker";
import { COMIC_STORY_TYPES, COMIC_EMOTION_TONES, COMIC_NARRATIVE_PRESETS } from "@/lib/canvas/comic-creation-settings";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import "./workbench.css";
import "./comic-workbench.css";

type Step = "source" | "assets" | "panels";
type ComicItem = ReturnType<typeof useComicWorkbench>["assets"][number];
type PromptDraft = { value: string; base: string; pendingSave?: boolean };
type TextImport = { name: string; bytes: Uint8Array; text: string; encoding: string; projectId: string };
type SettingsDraft = { id: string; value: AiConfig; base: string };
const assetLabels: Record<string, string> = { character: "角色", scene: "场景", prop: "道具" };
const imageSettingsKey = (value: AiConfig) => JSON.stringify([value.model, value.size, value.quality, value.imageResolution, value.count, value.transparentBackground, value.imageParameters]);

function imageSettingsSummary(config: AiConfig) {
    const profile = mergedImageCapabilityConfig(config, config.model || config.imageModel);
    const value = normalizeImageValue(profile, config);
    return [profile.size.parameter !== "none" ? imageSizeLabel(value.size) : "", profile.quality.supported ? imageQualityLabel(value.quality) : "", `${value.count} 张`].filter(Boolean).join(" · ");
}

function decodeText(bytes: Uint8Array, encoding?: string) {
    let selected = encoding;
    if (!selected) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) selected = "utf-16le";
        else if (bytes[0] === 0xfe && bytes[1] === 0xff) selected = "utf-16be";
        else {
            try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); selected = "utf-8"; }
            catch { selected = "gb18030"; }
        }
    }
    return { encoding: selected, text: new TextDecoder(selected).decode(bytes).replace(/^\uFEFF/, "") };
}

export default function ComicWorkbenchPage() {
    const workbench = useComicWorkbench();
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>("source");
    const [drafts, setDrafts] = useState<Record<string, PromptDraft>>({});
    const [savingId, setSavingId] = useState("");
    const [textImport, setTextImport] = useState<TextImport | null>(null);
    const [localError, setLocalError] = useState("");
    const [pendingNavigation, setPendingNavigation] = useState<(() => Promise<void>) | null>(null);
    const [preview, setPreview] = useState<Pick<ComicItem, "title" | "previewUrl"> | null>(null);
    const [nameDraft, setNameDraft] = useState<{ id: string; value: string; base: string; error?: string } | null>(null);
    const [savingName, setSavingName] = useState(false);
    const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
    const [savingSettings, setSavingSettings] = useState(false);
    const [settingsError, setSettingsError] = useState("");
    const [promptSaveError, setPromptSaveError] = useState<{ id: string; message: string } | null>(null);
    const [referencePicker, setReferencePicker] = useState<{ id: string; source: "project" | "library" } | null>(null);
    const [versionNodeId, setVersionNodeId] = useState("");
    const [referenceUploadId, setReferenceUploadId] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const referenceFileRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const projectIdRef = useRef(workbench.project?.id || "");
    projectIdRef.current = workbench.project?.id || "";
    const draftsRef = useRef(drafts);
    draftsRef.current = drafts;
    const previousAssetCount = useRef({ projectId: workbench.project?.id, count: workbench.assets.length });
    const items = useMemo(() => [...workbench.assets, ...workbench.panels], [workbench.assets, workbench.panels]);
    const dirtyIds = items.filter(item => drafts[item.id] && (drafts[item.id].value !== item.prompt || drafts[item.id].pendingSave)).map(item => item.id);
    const hasResult = workbench.assets.length > 0 || workbench.panels.length > 0;
    const generating = items.filter(item => item.status === "running").length;
    const disabled = workbench.busy || workbench.loading || !workbench.project;
    const visibleItems = step === "assets" ? workbench.assets : workbench.panels;
    const panelIds = workbench.panels.map(item => item.id).join("\n");
    const assetIds = workbench.assets.map(item => item.id).join("\n");
    const activePanel = workbench.panels.find(item => item.id === workbench.selectedId) ?? workbench.panels[0];
    const activeAsset = workbench.assets.find(item => item.id === workbench.selectedId) ?? workbench.assets[0];
    const itemStatus = (item: ComicItem) => item.status === "running" ? "生成中" : item.status === "failed" ? "未完成" : item.previewUrl ? "已有图片" : "待生成";
    const theme = canvasThemes[useActiveTheme()];
    const error = localError || workbench.error;
    const renameTarget = items.find(item => item.id === nameDraft?.id);
    const renameDisabled = disabled || savingName || !renameTarget || renameTarget.status === "running";
    const settingsTarget = items.find(item => item.id === settingsDraft?.id);
    const settingsDisabled = disabled || savingSettings || Boolean(settingsDraft?.id && (!settingsTarget || settingsTarget.status === "running"));
    const referenceTarget = items.find(item => item.id === referencePicker?.id);
    const versionNode = items.find(item => item.id === versionNodeId)?.node || null;
    const projectReferenceItems: AssetLibraryPickerItem[] = workbench.referenceCandidates.filter(item => item.id !== referencePicker?.id).map(item => ({
        id: item.id, title: item.title, category: item.assetKind || "other", kindLabel: assetLabels[item.assetKind || ""] || "画布图片", mediaKind: "image", imageUrl: item.previewUrl, imageFit: "contain",
        disabledReason: referenceTarget?.referenceAssetIds.includes(item.id) ? "已经关联此参考图" : item.missing ? "请先生成或上传此图片" : undefined,
    }));

    useEffect(() => {
        setDrafts({}); setTextImport(null); setPreview(null); setNameDraft(null); setSavingName(false); setLocalError(""); setSavingId(""); setPendingNavigation(null); setStep("source");
        setSettingsDraft(null); setSettingsError(""); setSavingSettings(false); setReferencePicker(null); setVersionNodeId(""); setReferenceUploadId(""); setPromptSaveError(null);
    }, [workbench.project?.id]);
    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [step]);
    useEffect(() => {
        const ids = step === "panels" ? panelIds : step === "assets" ? assetIds : "";
        if (!ids || ids.split("\n").includes(workbench.selectedId)) return;
        workbench.setSelectedId(ids.split("\n")[0]);
    }, [step, panelIds, assetIds, workbench.selectedId, workbench.setSelectedId]);
    useEffect(() => {
        const previous = previousAssetCount.current;
        if (previous.projectId === workbench.project?.id && previous.count === 0 && workbench.assets.length > 0) {
            setStep(current => current === "source" ? "assets" : current);
        }
        previousAssetCount.current = { projectId: workbench.project?.id, count: workbench.assets.length };
    }, [workbench.project?.id, workbench.assets.length]);

    const run = async (action: () => Promise<void>) => {
        const projectId = projectIdRef.current;
        try { await action(); }
        catch (cause) { if (projectId === projectIdRef.current && !workbench.error) setLocalError(cause instanceof Error ? cause.message : "操作未完成，请重试"); }
    };
    const changeProject = (action: () => Promise<void>) => {
        if (dirtyIds.length) setPendingNavigation(() => action);
        else void run(action);
    };
    const editPrompt = (item: ComicItem, value: string) => {
        workbench.setSelectedId(item.id);
        setDrafts(current => ({ ...current, [item.id]: { value, base: current[item.id]?.base ?? item.prompt, pendingSave: current[item.id]?.pendingSave } }));
    };
    const savePrompt = async (item: ComicItem) => {
        const draft = draftsRef.current[item.id];
        if (!draft || (draft.value === item.prompt && !draft.pendingSave)) return;
        if (draft.base !== item.prompt) { setLocalError("该提示词已被其他操作更新。本地输入仍保留，请先核对最新版本。"); return; }
        const projectId = projectIdRef.current;
        setSavingId(item.id); setLocalError(""); setPromptSaveError(null);
        try {
            await workbench.updatePrompt(item.id, draft.value);
            if (projectId !== projectIdRef.current) return;
            setPromptSaveError(current => current?.id === item.id ? null : current);
            setDrafts(current => {
                const latest = current[item.id];
                if (!latest) return current;
                if (latest.value === draft.value && latest.base === draft.base) {
                    const next = { ...current }; delete next[item.id]; return next;
                }
                return { ...current, [item.id]: { ...latest, base: draft.value } };
            });
        } catch (cause) {
            if (projectId === projectIdRef.current) {
                const node = useCanvasStore.getState().projects.find(project => project.id === projectId)?.nodes.find(node => node.id === item.id);
                if (node && nodeGenerationPrompt(node) === draft.value) setDrafts(current => current[item.id] ? { ...current, [item.id]: { ...current[item.id], base: draft.value, pendingSave: true } } : current);
                const message = cause instanceof Error ? cause.message : "提示词未保存，本地输入已保留";
                setPromptSaveError({ id: item.id, message });
                setLocalError(message);
            }
        }
        finally { if (projectId === projectIdRef.current) setSavingId(""); }
    };
    const chooseFile = async (file?: File) => {
        if (!file) return;
        const projectId = projectIdRef.current;
        setLocalError("");
        try {
            if (!/\.txt$/i.test(file.name)) throw new Error("请选择 TXT 文本文件");
            if (file.size > 8 * 1024 * 1024) throw new Error("请使用 8 MB 以内的 TXT 文件");
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (projectId !== projectIdRef.current) return;
            setTextImport({ name: file.name, bytes, ...decodeText(bytes), projectId });
        } catch (cause) { if (projectId === projectIdRef.current) setLocalError(cause instanceof Error ? cause.message : "文件读取失败"); }
    };
    const saveName = async () => {
        if (!nameDraft || !renameTarget || renameDisabled || !nameDraft.value.trim()) return;
        const submitted = nameDraft;
        const title = submitted.value.trim();
        if (renameTarget.title !== submitted.base && renameTarget.title !== title) {
            setNameDraft(current => current ? { ...current, error: "名称已被其他操作更新，请取消后重新打开核对。" } : current);
            return;
        }
        const projectId = projectIdRef.current;
        setSavingName(true);
        try {
            await workbench.renameNode(submitted.id, title);
            if (projectId === projectIdRef.current) setNameDraft(null);
        } catch (cause) {
            if (projectId === projectIdRef.current) setNameDraft(current => current ? { ...current, error: cause instanceof Error ? cause.message : "名称保存未完成，请稍后重试" } : current);
        } finally { if (projectId === projectIdRef.current) setSavingName(false); }
    };
    const derive = async () => {
        if (hasResult) return;
        await run(workbench.derive);
    };
    const openImageSettings = (item?: ComicItem) => {
        const value = item?.imageConfig || workbench.imageConfig;
        setSettingsError("");
        setSettingsDraft({ id: item?.id || "", value: { ...value }, base: imageSettingsKey(value) });
    };
    const saveImageSettings = async () => {
        if (!settingsDraft || settingsDisabled) return;
        const submitted = settingsDraft;
        const latest = submitted.id ? settingsTarget?.imageConfig : workbench.imageConfig;
        if (!latest || imageSettingsKey(latest) !== submitted.base) { setSettingsError("生图参数已被其他操作更新，请关闭后重新打开核对。"); return; }
        const projectId = projectIdRef.current;
        setSavingSettings(true); setSettingsError("");
        try {
            if (submitted.id) await workbench.updateImageConfig(submitted.id, submitted.value);
            else await workbench.updateDefaultImageConfig(submitted.value);
            if (projectId === projectIdRef.current) setSettingsDraft(null);
        } catch (cause) { if (projectId === projectIdRef.current) setSettingsError(cause instanceof Error ? cause.message : "生图参数未保存，请重试"); }
        finally { if (projectId === projectIdRef.current) setSavingSettings(false); }
    };
    const uploadReferences = async (files: File[]) => {
        const targetId = referenceUploadId;
        setReferenceUploadId("");
        if (!targetId || !files.length) return;
        await run(() => workbench.uploadReferenceFiles(targetId, files));
    };
    const pickReferences = async (ids: string[], pickedItems: AssetLibraryPickerItem[] = []) => {
        if (!referencePicker || !referenceTarget || disabled) return;
        const selection = referencePicker;
        const projectId = projectIdRef.current;
        try {
            if (selection.source === "project") await workbench.addReferenceNodes(selection.id, ids);
            else {
                const assets = pickedItems.flatMap(item => item.asset?.kind === "image" ? [item.asset] : []);
                if (!assets.length || assets.length !== ids.length) throw new Error("请选择资产库中的图片；外部图库图片请先保存到资产库或从本地上传。");
                await workbench.addLibraryReferences(selection.id, assets);
            }
            if (projectId === projectIdRef.current) setReferencePicker(null);
        } catch (cause) { if (projectId === projectIdRef.current) setLocalError(cause instanceof Error ? cause.message : "参考图未添加，请重试"); }
    };

    function renderItem(item: ComicItem, isPanel: boolean) {
        const draft = drafts[item.id];
        return <ComicImageCard key={item.id} item={item} isPanel={isPanel} selected={workbench.selectedId === item.id} disabled={disabled || Boolean(savingId)} saving={savingId === item.id}
            prompt={draft?.value ?? item.prompt} dirty={Boolean(draft && (draft.value !== item.prompt || draft.pendingSave))} stale={Boolean(draft && draft.base !== item.prompt)}
            saveError={promptSaveError?.id === item.id ? promptSaveError.message : ""}
            styleTitle={workbench.settings.styleSelection?.title || workbench.settings.style} settingsSummary={imageSettingsSummary(item.imageConfig)}
            onSelect={() => workbench.setSelectedId(item.id)} onRename={() => setNameDraft({ id: item.id, value: item.title, base: item.title })}
            onPrompt={value => editPrompt(item, value)} onSave={() => void savePrompt(item)} onReloadPrompt={() => { setPromptSaveError(current => current?.id === item.id ? null : current); setDrafts(current => { const next = { ...current }; delete next[item.id]; return next; }); }}
            onRefine={() => void run(() => workbench.refineNode(item.id))} onGenerate={() => void run(() => workbench.generateNode(item.id))}
            onSettings={() => openImageSettings(item)} onModel={model => void run(() => workbench.updateImageConfig(item.id, { ...item.imageConfig, model, ...(model !== item.imageConfig.model ? { imageParameters: "{}" } : {}) }))}
            onPick={source => setReferencePicker({ id: item.id, source })} onUpload={() => { setReferenceUploadId(item.id); referenceFileRef.current?.click(); }}
            onRemove={id => void run(() => workbench.removeReference(item.id, id))} onPreview={(title, previewUrl) => setPreview({ title, previewUrl })}
            onVersions={() => setVersionNodeId(item.id)} onAdopt={versionId => void run(async () => { await workbench.adoptVersion(item.id, versionId); })}
            onUnifiedStyle={value => void run(() => workbench.setNodeUnifiedStyle(item.id, value))} />;
    }

    return (
        <WorkspacePage fluid scroll={false} className="workbench-page comic-workbench-page">
            <div className="workbench-shell comic-workbench-shell">
                <header className="comic-workbench-header">
                    <div className="comic-workbench-title"><BookOpen aria-hidden /><div><h1>漫画制作</h1><p>从原文到资产与分镜，与自由画布共享同一份作品</p></div></div>
                    <div className="comic-workbench-project-actions">
                        <Select aria-label="选择漫画作品" value={workbench.project?.id} placeholder="选择漫画作品" options={workbench.projects.map(project => ({ value: project.id, label: project.title }))} onChange={id => changeProject(() => workbench.openProject(id))} loading={workbench.loading} disabled={workbench.busy} className="comic-project-select" showSearch optionFilterProp="label" />
                        <Button icon={<Plus />} onClick={() => changeProject(workbench.createProject)} disabled={workbench.busy}>新建作品</Button>
                        <Button icon={<ExternalLink />} disabled={!workbench.project || workbench.busy} onClick={() => { const id = projectIdRef.current; changeProject(async () => { await workbench.save(); if (id && id === projectIdRef.current) navigate(`/canvas/${encodeURIComponent(id)}`); }); }}>打开原画布</Button>
                    </div>
                </header>
                <div className="comic-workbench-navigation">
                    <SegmentedControl<Step> value={step} onChange={setStep} ariaLabel="漫画制作步骤" options={[{ value: "source", label: "01 原文与参数" }, { value: "assets", label: `02 资产 (${workbench.assets.length})` }, { value: "panels", label: `03 分镜 (${workbench.panels.length})` }]} />
                    <span className="comic-sync-state" role="status">{workbench.busy ? <LoaderCircle className="comic-spin" aria-hidden /> : null}{generating ? `${generating} 项生成中 · ` : ""}{workbench.syncState}</span>
                    {workbench.project ? <Button size="small" icon={<RefreshCw />} disabled={workbench.loading} onClick={() => void run(workbench.recover)}>刷新任务状态</Button> : null}
                </div>
                {error ? <Callout tone="error" onClose={() => { setLocalError(""); workbench.clearError(); }}>{error}</Callout> : null}
                {dirtyIds.length > 0 && step === "source" ? <Callout tone="info">有 {dirtyIds.length} 条提示词尚未保存，请返回对应资产或分镜保存。</Callout> : null}
                <div className="comic-workbench-content" ref={scrollRef}>
                    {workbench.loading ? <div className="comic-loading"><Spin /><span>正在载入漫画作品</span></div> : !workbench.project ? <EmptyState icon={BookOpen} title="开始一部漫画作品" description="创建作品后，上传 TXT 或粘贴正文。推导出的资产和分镜也能在自由画布继续制作。" action={<Button type="primary" icon={<Plus />} onClick={() => void run(workbench.createProject)}>新建作品</Button>} /> : step === "source" ? (
                        <div className="comic-source-grid">
                            <section className="workbench-composer comic-source-editor" aria-label="漫画原文">
                                <div className="comic-section-heading"><div><h2>原文</h2><p>上传 TXT，或直接粘贴小说、剧本正文。</p></div><Button icon={<Upload />} onClick={() => fileRef.current?.click()} disabled={disabled}>上传 TXT</Button></div>
                                <Input.TextArea aria-label="漫画原文" value={workbench.sourceText} placeholder="在此粘贴要改编为漫画的正文…" onChange={event => workbench.setSourceText(event.target.value)} disabled={workbench.busy} className="comic-source-textarea" />
                                <div className="comic-creation-controls" aria-label="创作设置">
                                    <label><span>故事类型</span><Select aria-label="故事类型" value={workbench.settings.storyType || "auto"} options={COMIC_STORY_TYPES} disabled={disabled} onChange={storyType => workbench.setSettings({ ...workbench.settings, storyType })} /></label>
                                    <label><span>情绪与色调</span><Select aria-label="情绪与色调" value={workbench.settings.emotionTone || "auto"} options={COMIC_EMOTION_TONES} disabled={disabled} onChange={emotionTone => workbench.setSettings({ ...workbench.settings, emotionTone })} /></label>
                                    <label><span>分镜数量</span><Select<string | number> aria-label="分镜数量" value={workbench.settings.panelCount} options={[{ value: "auto", label: "自动判断" }, ...Array.from({ length: 24 }, (_, index) => ({ value: index + 1, label: `${index + 1} 镜` }))]} disabled={disabled} onChange={panelCount => workbench.setSettings({ ...workbench.settings, panelCount: panelCount === "auto" ? "auto" : Number(panelCount) })} /></label>
                                    <label><span>叙事预设</span><Select aria-label="叙事预设" value={workbench.settings.narrativePreset || "audio_comic_drama"} options={COMIC_NARRATIVE_PRESETS.map(({ value, label }) => ({ value, label }))} disabled={disabled} onChange={narrativePreset => workbench.setSettings({ ...workbench.settings, narrativePreset })} /></label>
                                </div>
                                <div className="comic-source-footer"><span>{workbench.sourceText.length.toLocaleString()} 字</span><Button icon={<Save />} onClick={() => void run(workbench.save)} disabled={disabled}>保存原文与参数</Button></div>
                            </section>
                            <section className="workbench-composer comic-source-settings" aria-label="推导参数">
                                <div className="comic-section-heading"><div><h2>推导参数</h2><p>先整理可编辑的资产设定和分镜提示词。</p></div></div>
                                <ComicStylePicker value={workbench.settings.style} selection={workbench.settings.styleSelection} disabled={disabled} contextKey={`${getActiveUserScope()}:${workbench.project.id}`} onChange={(style, styleSelection) => workbench.setSettings({ ...workbench.settings, style, styleSelection })} />
                                <div className="comic-field"><span>文本推理模型</span><ModelPicker config={workbench.textConfig} value={workbench.textModel} capability="text" onChange={workbench.setTextModel} fullWidth variant="creation" /></div>
                                <div className="comic-source-next"><FileText aria-hidden /><p>生成资产提示词和分镜提示词后，可逐条修改，也可以交给影策 AI 继续细化。</p></div>
                                {hasResult ? <Callout tone="info" title="这部作品已完成推导">原文和当前成果均会保留。需要重新推导时，请新建作品；已有资产和分镜仍可继续编辑、生图。</Callout> : null}
                                <Button type="primary" size="large" icon={<Sparkles />} loading={workbench.busy} disabled={disabled || hasResult || !workbench.sourceText.trim() || !workbench.textModel} onClick={() => void derive()}>推导资产与分镜 <ArrowRight /></Button>
                            </section>
                        </div>
                    ) : (
                        <div className={`comic-step-frame is-studio ${step === "panels" ? "is-panels" : "is-assets"}`}>
                            <div className="comic-results-toolbar">
                                <div><h2>{step === "assets" ? "资产" : "分镜"}</h2><p>{step === "assets" ? "选中一项，左边看图和版本，右边写提示词并生成。" : "先看结果或改提示词，再确认参考图和参数。"}</p></div>
                                <div className="comic-toolbar-actions">
                                    <button type="button" className="comic-default-chip" disabled={disabled} onClick={() => openImageSettings()}>{configuredModelDisplayName(workbench.imageConfig, workbench.imageConfig.model || workbench.imageConfig.imageModel)} · {imageSettingsSummary(workbench.imageConfig)}</button>
                                    <Button type="primary" icon={<ImageIcon />} disabled={disabled || !visibleItems.length || generating > 0 || dirtyIds.length > 0} onClick={() => void run(step === "assets" ? workbench.generateAssets : workbench.generatePanels)}>{step === "assets" ? "生成缺图资产" : "生成就绪分镜"}</Button>
                                </div>
                            </div>
                            {!visibleItems.length ? <EmptyState icon={step === "assets" ? ImageIcon : BookOpen} title={step === "assets" ? "还没有资产" : "还没有分镜"} description="在原文与参数中完成推导后，即可在这里继续制作。" action={<Button onClick={() => setStep("source")}>返回原文与参数</Button>} /> : <div className="comic-studio-workspace">
                                <nav className="comic-studio-rail" aria-label={step === "assets" ? "资产列表" : "分镜列表"}>{(step === "assets" ? workbench.assets : workbench.panels).map((entry, index) => <button type="button" key={entry.id} className="comic-studio-rail-item" aria-pressed={entry.id === (step === "assets" ? activeAsset : activePanel)?.id} onClick={() => workbench.setSelectedId(entry.id)}>
                                    <span className="comic-studio-rail-index">{step === "assets" ? ({ character: "角", scene: "景", prop: "具" }[entry.assetKind || ""] || index + 1) : index + 1}</span>
                                    <span className="comic-studio-rail-thumb">{entry.previewUrl ? <MediaPreview src={entry.previewUrl} kind="image" alt="" className="comic-studio-rail-image" loading="lazy" /> : <ImageIcon aria-hidden />}</span>
                                    <span className="comic-studio-rail-copy"><strong>{entry.title}</strong><small>{itemStatus(entry)}{drafts[entry.id] && (drafts[entry.id].value !== entry.prompt || drafts[entry.id].pendingSave) ? " · 未保存" : ""}</small></span>
                                </button>)}</nav>
                                <div className="comic-studio-main">{step === "assets" ? (activeAsset ? renderItem(activeAsset, false) : null) : (activePanel ? renderItem(activePanel, true) : null)}</div>
                            </div>}
                        </div>
                    )}
                </div>
            </div>
            <input ref={fileRef} type="file" accept=".txt,text/plain" className="sr-only" aria-label="选择 TXT 文件" onChange={event => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <input ref={referenceFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="sr-only" aria-label="选择参考图片" onChange={event => { void uploadReferences(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
            <AppModal title="导入 TXT" open={Boolean(textImport)} onCancel={() => setTextImport(null)} width="min(720px, calc(100vw - 32px))" footer={<><Button onClick={() => setTextImport(null)}>取消</Button><Button type="primary" disabled={!textImport || textImport.projectId !== workbench.project?.id || !textImport.text.trim()} onClick={() => { if (!textImport || textImport.projectId !== projectIdRef.current) return; workbench.setSourceText(textImport.text); setTextImport(null); setStep("source"); }}>确认导入正文</Button></>}>
                {textImport ? <div className="comic-import-content"><p className="comic-muted">{textImport.name} · {textImport.text.length.toLocaleString()} 字</p><label className="comic-field"><span>文件编码</span><Select aria-label="TXT 文件编码" value={textImport.encoding} options={[{ value: "utf-8", label: "UTF-8 / BOM" }, { value: "gb18030", label: "GB18030 / GBK" }, { value: "utf-16le", label: "UTF-16 LE" }, { value: "utf-16be", label: "UTF-16 BE" }]} onChange={encoding => setTextImport({ ...textImport, ...decodeText(textImport.bytes, encoding) })} /></label><Input.TextArea aria-label="TXT 解码预览" value={textImport.text.slice(0, 5000)} readOnly autoSize={{ minRows: 10, maxRows: 16 }} /><p className="comic-muted">预览前 5000 字，导入保留全文。请检查中文是否正常。</p></div> : null}
            </AppModal>
            <AppModal title="修改名称" open={Boolean(nameDraft)} onCancel={() => { if (!savingName) setNameDraft(null); }} maskClosable={!savingName} closable={!savingName} width={420} footer={<><Button disabled={savingName} onClick={() => setNameDraft(null)}>取消</Button><Button type="primary" loading={savingName} disabled={renameDisabled || !nameDraft?.value.trim()} onClick={() => void saveName()}>保存名称</Button></>}>
                <div className="comic-import-content"><label className="comic-field"><span>名称</span><Input aria-label="资产或分镜名称" autoFocus maxLength={200} showCount value={nameDraft?.value || ""} disabled={renameDisabled} onChange={event => setNameDraft(current => current ? { ...current, value: event.target.value, error: undefined } : current)} onPressEnter={event => { if (!event.nativeEvent.isComposing) void saveName(); }} /></label>{nameDraft?.error ? <Callout tone="error">{nameDraft.error}</Callout> : null}</div>
            </AppModal>
            <AppModal title="还有未保存的提示词" open={Boolean(pendingNavigation)} onCancel={() => setPendingNavigation(null)} footer={<><Button onClick={() => setPendingNavigation(null)}>返回保存</Button><Button danger onClick={() => { const action = pendingNavigation; setPendingNavigation(null); setDrafts({}); if (action) void run(action); }}>放弃未保存编辑并继续</Button></>}><p>有 {dirtyIds.length} 条本地提示词编辑尚未保存。切换作品或离开页面后，这些编辑不会写入作品。</p></AppModal>
            <AppModal title={preview?.title || "图片预览"} open={Boolean(preview)} onCancel={() => setPreview(null)} footer={null} width="min(1000px, calc(100vw - 32px))">{preview?.previewUrl ? <MediaPreview src={preview.previewUrl} kind="image" alt={preview.title} className="comic-full-preview" /> : null}</AppModal>
            <AppModal title={settingsDraft?.id ? `${settingsTarget?.title || "当前图片"} · 生图参数` : "默认生图设置"} open={Boolean(settingsDraft)} onCancel={() => { if (!savingSettings) setSettingsDraft(null); }} maskClosable={!savingSettings} closable={!savingSettings} width={520} footer={<><Button disabled={savingSettings} onClick={() => setSettingsDraft(null)}>取消</Button><Button type="primary" loading={savingSettings} disabled={settingsDisabled} onClick={() => void saveImageSettings()}>保存生图参数</Button></>}>
                {settingsDraft ? <div className="comic-generation-settings">
                    <fieldset disabled={settingsDisabled}><legend className="sr-only">图片生成模型与参数</legend><div className="comic-field"><span>图片模型</span><ModelPicker config={settingsDraft.value} value={settingsDraft.value.model} capability="image" fullWidth variant="creation" requirements={{ capability: "image", input: { textCount: 1, imageCount: settingsTarget?.references.length || 0, referenceImageCount: settingsTarget?.references.length || 0, videoCount: 0, audioCount: 0, characterCount: 0 } }} onChange={model => { if (!settingsDisabled) setSettingsDraft(current => current ? { ...current, value: { ...current.value, model, ...(model !== current.value.model ? { imageParameters: "{}" } : {}) } } : current); }} /></div>
                    <ImageSettingsPanel config={settingsDraft.value} theme={theme} showTitle={false} showCount={false} maxCount={1} className="comic-native-image-settings" onConfigChange={(key, value) => { if (!settingsDisabled) setSettingsDraft(current => current ? { ...current, value: { ...current.value, [key]: value } } : current); }} /></fieldset>
                    <p className="comic-muted">{settingsDraft.id ? "仅应用到这张资产或分镜。重新生成会保存为新版本，可随时对比和切换。" : "推导时新建的资产与分镜使用这些参数。已有条目的模型与参数保持不变，请在对应条目中调整。"}</p>
                    {settingsError ? <Callout tone="error">{settingsError}</Callout> : null}
                </div> : null}
            </AppModal>
            {referencePicker ? <AssetLibraryPickerModal key={`${referencePicker.id}:${referencePicker.source}`} open remoteLibrary={referencePicker.source === "library"} remoteKind="image" acceptRemoteItems mediaKinds={["image"]} items={referencePicker.source === "project" ? projectReferenceItems : []} categoryLabels={referencePicker.source === "project" ? { ...assetLabels, other: "画布图片" } : ASSET_CATEGORY_LABELS} title={referencePicker.source === "project" ? "关联作品图片" : "选择参考图片"} eyebrow={referenceTarget?.title || "参考图片"} emptyTitle={referencePicker.source === "project" ? "暂无可用的作品图片" : "资产库暂无图片"} emptyDescription={referencePicker.source === "project" ? "先生成作品资产，或从本地上传参考图片。" : "可返回后从本地上传图片。"} footerNote={referencePicker.source === "project" ? "关联后会自动使用该图片节点的当前版本。" : "图片将作为当前条目的参考，不替换生成结果。"} confirmLabel={count => `添加参考图${count ? ` (${count})` : ""}`} loading={workbench.busy} onClose={() => { if (!workbench.busy) setReferencePicker(null); }} onConfirm={pickReferences} /> : null}
            <CanvasMediaVersionModal node={versionNode} onClose={() => setVersionNodeId("")} onAdopt={(nodeId, versionId) => { const projectId = projectIdRef.current; void run(async () => { if (await workbench.adoptVersion(nodeId, versionId) && projectId === projectIdRef.current) setVersionNodeId(""); }); return false; }} onDelete={(nodeId, versionId) => { void run(async () => { await workbench.deleteVersion(nodeId, versionId); }); return false; }} onExtract={(nodeId, versionId) => { const projectId = projectIdRef.current; void run(async () => { if (await workbench.extractVersion(nodeId, versionId) && projectId === projectIdRef.current) setVersionNodeId(""); }); }} />
        </WorkspacePage>
    );
}

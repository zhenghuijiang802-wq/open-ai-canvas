import { useEffect, useState } from "react";
import { Button } from "antd";
import { BookOpen, Check, FolderOpen, History, Image as ImageIcon, LoaderCircle, Pencil, Plus, Save, SlidersHorizontal, Sparkles, Upload } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { MediaPreview } from "@/components/media-preview";
import { ModelPicker } from "@/components/model-picker";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { Switch } from "@/components/ui/base/switch";
import { Callout } from "@/components/ui/product/callout/callout";
import { currentMediaVersion, listMediaVersions } from "@/lib/canvas/canvas-media-versions";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import type { ComicWorkbenchItem } from "./use-comic-workbench";
import { ReferenceCard } from "./workbench-reference-card";

type Props = {
    item: ComicWorkbenchItem; isPanel: boolean; selected: boolean; disabled: boolean; saving: boolean;
    prompt: string; dirty: boolean; stale: boolean; styleTitle: string; settingsSummary: string;
    onSelect: () => void; onRename: () => void; onPrompt: (value: string) => void; onSave: () => void; onReloadPrompt: () => void;
    onRefine: () => void; onGenerate: () => void; onSettings: () => void; onModel: (model: string) => void;
    onPick: (source: "project" | "library") => void; onUpload: () => void; onRemove: (id: string) => void;
    onPreview: (title: string, url?: string) => void; onVersions: () => void; onAdopt: (id: string) => void; onUnifiedStyle: (value: boolean) => void;
};

export function ComicImageCard(props: Props) {
    const { item, isPanel, disabled, saving, prompt, dirty, stale } = props;
    const versions = listMediaVersions(item.node), current = currentMediaVersion(item.node);
    const running = item.status === "running", unavailable = disabled || running || saving;
    const [editing, setEditing] = useState(false);
    // A newly returned image replaces the input surface; unsaved user text remains editable.
    useEffect(() => { if (!dirty) setEditing(false); }, [current?.id]);
    const showPrompt = !isPanel || !item.previewUrl || editing || dirty || stale;
    const profile = mergedImageCapabilityConfig(item.imageConfig, item.imageConfig.model || item.imageConfig.imageModel);
    const limit = profile.references.maxImages, canAdd = !unavailable && item.references.length < limit;
    const image = <button className="comic-item-preview" type="button" aria-label={`放大查看${item.title}`} onClick={() => props.onPreview(item.title, item.previewUrl)} disabled={!item.previewUrl}>
        {item.previewUrl ? <MediaPreview src={item.previewUrl} kind="image" alt={item.title} className="comic-item-image" loading="lazy" /> : <span className="comic-item-placeholder"><ImageIcon aria-hidden /><span>生成后在这里查看资产图片</span></span>}
        {running ? <span className="comic-generation-overlay" role="status"><LoaderCircle aria-hidden />正在生成新版本</span> : null}
    </button>;
    const editor = <>
        <div className="comic-item-editor-label"><label htmlFor={`comic-prompt-${item.id}`}>{isPanel ? "画面提示词" : "生图提示词 / 资产描述"}</label><span>{dirty ? "未保存" : "已保存"}</span></div>
        <CanvasResourceMentionTextarea id={`comic-prompt-${item.id}`} aria-label={`${item.title}生图提示词`} value={prompt} onChange={props.onPrompt}
            references={item.references.flatMap((reference, index) => reference.source === "style" ? [] : [{ id: reference.id, nodeId: reference.id, kind: "image" as const, label: `图片${index + 1}`, title: reference.title, previewUrl: reference.previewUrl, active: true, mentionToken: `@[node:${reference.id}]` }])}
            sendOnEnter={false} onSubmit={() => { if (!unavailable && !dirty && !stale && !item.missingReferenceIds.length) props.onGenerate(); }} rows={isPanel ? 9 : 6} disabled={unavailable}
            className="workbench-prompt-input comic-prompt-input" containerClassName="comic-prompt-composer" placeholder="写下要生成的画面：主体、场景、构图、光线、风格。输入 @ 引用参考图。" />
    </>;
    return <article className={`comic-item ${isPanel ? "is-panel" : "is-asset"} ${props.selected ? "is-selected" : ""}`} onFocusCapture={props.onSelect} onClick={props.onSelect}>
        <header className="comic-item-heading"><div className="comic-item-identity"><span className="comic-item-kind">{isPanel ? "分镜" : ({ character: "角色", scene: "场景", prop: "道具" }[item.assetKind || ""] || "资产")}</span><h3>{item.title}</h3><Button type="text" size="small" icon={<Pencil />} aria-label={`修改${item.title}名称`} disabled={unavailable} onClick={props.onRename} /></div><span className="comic-item-status" role="status">{running ? "生成中" : item.status === "failed" ? "生成未完成" : item.previewUrl ? "已有图片" : "待生成"}</span></header>
        <div className="comic-item-layout">
            {!isPanel ? <section className="comic-item-media" aria-label={`${item.title}图片与版本`}>
                {image}
                <div className="comic-version-row"><span>画廊 · {versions.length} 张</span><Button type="text" size="small" icon={<History />} disabled={!versions.length} onClick={props.onVersions} aria-label={`管理${item.title}图片版本`}>管理版本</Button></div>
                {versions.length ? <div className="comic-version-gallery" aria-label={`${item.title}版本画廊`}>{versions.map(version => <button type="button" key={version.id} aria-label={`使用${item.title}的 V${version.number}`} aria-pressed={version.id === current?.id} disabled={unavailable} onClick={() => { if (version.id !== current?.id) props.onAdopt(version.id); }}>
                    <CachedResourceImage storageKey={version.media.storageKey} src={version.media.content || version.media.previewContent} alt={`V${version.number}`} className="comic-version-thumbnail" fallback={<ImageIcon aria-hidden />} />
                    <span>{version.id === current?.id ? <Check aria-hidden /> : null}V{version.number} {version.id === current?.id ? "当前使用" : ""}</span>
                </button>)}</div> : <p className="comic-muted">生成结果会保留在画廊，可随时切换使用。</p>}
            </section> : null}
            <section className="comic-item-editor" aria-label={`${item.title}生图工作区`}>
                <div className={`comic-main-surface ${!showPrompt ? "is-result" : ""}`}>{showPrompt ? editor : image}</div>
                {stale ? <Callout tone="warning" title="提示词已有更新"><p>本地编辑已保留，请核对后载入最新提示词。</p><Button size="small" onClick={props.onReloadPrompt}>载入最新提示词</Button></Callout> : null}
                <div className="comic-prompt-actions">
                    {isPanel && item.previewUrl ? <Button type="text" size="small" icon={showPrompt ? <ImageIcon /> : <Pencil />} disabled={running || dirty} onClick={() => setEditing(!showPrompt)}>{showPrompt ? (dirty ? "保存后查看图片" : "查看生成图片") : "编辑提示词"}</Button> : null}
                    {dirty ? <Button size="small" icon={<Save />} loading={saving} disabled={unavailable || stale} onClick={props.onSave}>保存提示词</Button> : null}
                    <Button type="text" size="small" icon={<Sparkles />} disabled={unavailable || dirty || stale} onClick={props.onRefine}>AI 细化</Button>
                    {isPanel && versions.length ? <Button type="text" size="small" icon={<History />} onClick={props.onVersions} aria-label={`管理${item.title}图片版本`}>版本 {versions.length}</Button> : null}
                </div>
                <div className="comic-reference-section">
                    <div className="workbench-composer-toolbar"><span className="workbench-ref-count">参考素材 {item.references.length} / {limit}</span><div className="workbench-toolbar-actions">
                        <button type="button" title="关联作品图片" aria-label={`为${item.title}关联作品图片`} disabled={unavailable || !limit} onClick={() => props.onPick("project")}><BookOpen /></button>
                        <button type="button" title="从资产库选择" aria-label={`为${item.title}从资产库选择参考图`} disabled={unavailable || !limit} onClick={() => props.onPick("library")}><FolderOpen /></button>
                        <button type="button" title="从本地上传" aria-label={`为${item.title}上传参考图`} disabled={!canAdd} onClick={props.onUpload}><Upload /></button>
                    </div></div>
                    <div className="workbench-reference-grid">
                        {item.references.map(reference => <div className={`comic-reference-entry ${reference.source === "style" ? "is-style-reference" : ""}`} key={reference.id}>
                            <ReferenceCard kind="image" reference={{ id: reference.id, name: reference.title, previewUrl: reference.previewUrl || "", kind: "image", role: "reference", progress: 100, uploading: false, error: reference.missing ? "参考图未就绪" : undefined }} disabled={unavailable || reference.source === "style"} errorLabel="未就绪" onPreview={() => props.onPreview(reference.title, reference.previewUrl)} onRemove={() => props.onRemove(reference.id)} />
                            <span className="comic-reference-name" title={reference.title}>{reference.title}</span>
                        </div>)}
                        {canAdd ? <button type="button" className="workbench-reference-placeholder" onClick={() => props.onPick("library")} aria-label={`为${item.title}添加参考图`}><Plus aria-hidden /><span>添加参考图</span></button> : null}
                    </div>
                    {item.missingReferenceIds.length ? <p className="comic-muted">{item.missingReferenceIds.length} 项参考图未就绪，请先生成或重新选择。</p> : null}
                </div>
                <div className="comic-style-row"><span title={props.styleTitle}>统一画风{item.useUnifiedStyle && props.styleTitle ? ` · ${props.styleTitle}` : ""}</span><Switch size="sm" aria-label={`${item.title}统一画风`} checked={item.useUnifiedStyle} disabled={unavailable} onChange={props.onUnifiedStyle} /></div>
                {item.error ? <Callout tone="error">{item.error}</Callout> : null}
                <fieldset disabled={unavailable} className="workbench-composer-dock comic-generation-dock" aria-label={`${item.title}生成设置`}>
                    <ModelPicker config={item.imageConfig} value={item.imageConfig.model} capability="image" fullWidth variant="creation" className="workbench-model-picker" showSelectedPrice={false} requirements={{ capability: "image", input: { textCount: 1, imageCount: item.references.length, referenceImageCount: item.references.length, videoCount: 0, audioCount: 0, characterCount: 0 } }} onChange={model => { if (!unavailable) props.onModel(model); }} />
                    <button type="button" className="workbench-parameters-trigger" title={props.settingsSummary} aria-label={`调整${item.title}生图参数`} onClick={props.onSettings}><SlidersHorizontal /><span>{props.settingsSummary}</span></button>
                    <Button type="primary" className="workbench-submit" icon={<ImageIcon />} loading={running} disabled={unavailable || dirty || stale || !prompt.trim() || !item.imageConfig.model || item.missingReferenceIds.length > 0} onClick={props.onGenerate}>{item.previewUrl ? "重新生成" : "生成"}</Button>
                </fieldset>
            </section>
        </div>
    </article>;
}

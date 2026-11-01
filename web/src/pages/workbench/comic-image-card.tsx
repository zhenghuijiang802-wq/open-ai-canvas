import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { BookOpen, FolderOpen, History, Image as ImageIcon, LoaderCircle, Pencil, Plus, Save, SlidersHorizontal, Sparkles, Upload, X } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { MediaPreview } from "@/components/media-preview";
import { ModelPicker } from "@/components/model-picker";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { Callout } from "@/components/ui/product/callout/callout";
import { currentMediaVersion, listMediaVersions } from "@/lib/canvas/canvas-media-versions";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import type { ComicWorkbenchItem, ComicWorkbenchReference } from "./use-comic-workbench";
import { ReferenceCard } from "./workbench-reference-card";

type Props = {
    item: ComicWorkbenchItem; isPanel: boolean; selected: boolean; disabled: boolean; saving: boolean;
    prompt: string; dirty: boolean; stale: boolean; saveError?: string; settingsSummary: string; batchDisabled: boolean;
    onSelect: () => void; onRename: () => void; onPrompt: (value: string) => void; onSave: () => void; onReloadPrompt: () => void;
    onRefine: () => void; onGenerate: () => void; onSettings: () => void; onModel: (model: string) => void;
    onPick: (source: "project" | "library") => void; onUpload: () => void; onRemove: (id: string) => void;
    onPreview: (title: string, url?: string) => void; onVersions: () => void; onAdopt: (id: string) => void; onStylePick: () => void; onStyleRemove: () => void; onBatchGenerate: () => void;
};

const assetKindLabel: Record<string, string> = { character: "角色", scene: "场景", prop: "道具" };

function referenceCaption(reference: ComicWorkbenchReference) {
    if (reference.source === "style") return "画风";
    if (reference.assetKind) return assetKindLabel[reference.assetKind] || "资产";
    return "参考图";
}

export function ComicImageCard(props: Props) {
    const { item, isPanel, disabled, saving, prompt, dirty, stale } = props;
    const versions = listMediaVersions(item.node), current = currentMediaVersion(item.node);
    const running = item.status === "running", unavailable = disabled || running || saving;
    const [editing, setEditing] = useState(() => dirty || stale);
    const draftLock = useRef({ dirty, stale });
    draftLock.current = { dirty, stale };
    useEffect(() => { if (!draftLock.current.dirty && !draftLock.current.stale) setEditing(false); }, [current?.id]);
    const showResult = isPanel && Boolean(item.previewUrl) && !editing;
    const profile = mergedImageCapabilityConfig(item.imageConfig, item.imageConfig.model || item.imageConfig.imageModel);
    const stylePreview = item.styleReference?.coverUrl || item.references.find(reference => reference.source === "style")?.previewUrl;
    const limit = profile.references.maxImages, canAdd = !unavailable && item.references.length < limit;
    const canGenerate = !unavailable && !dirty && !stale && Boolean(prompt.trim()) && Boolean(item.imageConfig.model) && item.missingReferenceIds.length === 0;
    const kind = isPanel ? "分镜" : assetKindLabel[item.assetKind || ""] || "资产";
    const status = running ? "生成中" : item.status === "failed" ? "生成未完成" : item.previewUrl ? "已有图片" : "待生成";
    const image = <button className="comic-stage-preview" type="button" aria-label={`放大查看${item.title}`} onClick={() => props.onPreview(item.title, item.previewUrl)} disabled={!item.previewUrl}>
        {item.previewUrl ? <MediaPreview src={item.previewUrl} kind="image" alt={item.title} className="comic-stage-image" loading="eager" /> : <span className="comic-stage-empty"><ImageIcon aria-hidden /><strong>{isPanel ? "画面会显示在这里" : "资产图会显示在这里"}</strong><span>保持原始比例，生成后可放大查看。</span></span>}
        {running ? <span className="comic-generation-overlay" role="status"><LoaderCircle aria-hidden />正在生成新版本</span> : null}
    </button>;
    const heading = <header className="comic-studio-heading">
        <div className="comic-studio-identity">
            <span className="comic-kind" data-kind={isPanel ? "panel" : item.assetKind || "asset"}>{kind}</span>
            <h3>{item.title}</h3>
            <Button type="text" size="small" icon={<Pencil />} aria-label={`修改${item.title}名称`} disabled={unavailable} onClick={props.onRename} />
        </div>
        <span className="comic-status" data-status={running ? "running" : item.status} role="status">{status}</span>
    </header>;
    const versionsStrip = <div className="comic-version-strip">
        <div className="comic-version-row"><span>版本 {versions.length || 0}</span><Button type="text" size="small" icon={<History />} disabled={!versions.length} onClick={props.onVersions} aria-label={`管理${item.title}图片版本`}>管理</Button></div>
        {versions.length ? <div className="comic-version-gallery" aria-label={`${item.title}版本画廊`}>{versions.map(version => <button type="button" key={version.id} className={version.id === current?.id ? "is-current" : ""} aria-label={version.id === current?.id ? `${item.title}当前使用 V${version.number}` : `将${item.title}切换为 V${version.number}`} aria-pressed={version.id === current?.id} disabled={unavailable} onClick={() => { if (version.id !== current?.id) props.onAdopt(version.id); }}>
            <span className="comic-version-thumb">
                <CachedResourceImage storageKey={version.media.storageKey} src={version.media.content || version.media.previewContent} alt="" className="comic-version-thumbnail" fallback={<ImageIcon aria-hidden />} />
                {version.id === current?.id ? <span className="comic-version-current">当前</span> : null}
            </span>
            <span>V{version.number}</span>
        </button>)}</div> : <p className="comic-muted">每次生成都会留下一个版本，可以随时切回。</p>}
    </div>;
    return <article aria-busy={running} className={`comic-studio ${isPanel ? "is-panel" : "is-asset"}`} onFocusCapture={props.onSelect} onClick={props.onSelect}>
        {!isPanel ? <section className="comic-stage" aria-label={`${item.title}图片与版本`}>
            {heading}
            <div className="comic-stage-well">{image}</div>
            {versionsStrip}
        </section> : null}
        <section className="comic-composer" aria-label={`${item.title}生图工作区`}>
            {isPanel ? heading : <div className="comic-composer-kicker"><span>提示词与生成</span><span>{dirty ? "有未保存修改" : "已同步到作品"}</span></div>}
            <div className="comic-composer-scroll">
                <div className={`comic-hero ${showResult ? "is-result" : "is-prompt"}`}>
                    {showResult ? image : <div className="comic-prompt-surface">
                        <label htmlFor={`comic-prompt-${item.id}`}>{isPanel ? "画面提示词" : "生图提示词"}</label>
                        <CanvasResourceMentionTextarea id={`comic-prompt-${item.id}`} aria-label={`${item.title}生图提示词`} value={prompt} onChange={props.onPrompt}
                            references={item.references.flatMap((reference, index) => reference.source === "style" ? [] : [{ id: reference.id, nodeId: reference.id, kind: "image" as const, label: `图片${index + 1}`, title: reference.title, previewUrl: reference.previewUrl, active: true, mentionToken: `@[node:${reference.id}]` }])}
                            sendOnEnter={false} onSubmit={() => { if (canGenerate) props.onGenerate(); }} rows={8} disabled={unavailable}
                            className="workbench-prompt-input comic-prompt-input" containerClassName="comic-prompt-composer" placeholder="写下主体、场景、构图、光线。输入 @ 引用参考图。" />
                    </div>}
                </div>
                {stale ? <Callout tone="warning" title="提示词已有更新" action={<Button size="small" onClick={props.onReloadPrompt}>载入最新提示词</Button>}><p>本地编辑已保留，核对后再载入。</p></Callout> : null}
                {props.saveError ? <Callout tone="error" title="提示词未保存" action={<Button size="small" icon={<Save />} loading={saving} disabled={unavailable || stale} onClick={props.onSave}>重试保存</Button>}>{props.saveError}</Callout> : null}
                <div className="comic-result-bar">
                    {isPanel && item.previewUrl ? <Button icon={showResult ? <Pencil /> : <ImageIcon />} disabled={running || saving} onClick={() => setEditing(showResult)}>{showResult ? "编辑提示词" : "返回生成结果"}</Button> : null}
                    <span className={`comic-draft-state${dirty ? " is-dirty" : ""}`} role="status">{dirty ? "未保存" : "已保存"}</span>
                    {dirty ? <Button size="small" icon={<Save />} loading={saving} disabled={unavailable || stale} onClick={props.onSave}>保存提示词</Button> : null}
                    <span className="comic-result-bar-end">
                        <Button type="text" size="small" icon={<Sparkles />} disabled={unavailable || dirty || stale} onClick={props.onRefine}>AI 细化</Button>
                        {isPanel && versions.length ? <Button type="text" size="small" icon={<History />} onClick={props.onVersions} aria-label={`管理${item.title}图片版本`}>版本 {versions.length}</Button> : null}
                    </span>
                </div>
                <div className="comic-reference-section">
                    <div className="workbench-composer-toolbar"><span className="workbench-ref-count">参考素材 {item.references.length} / {limit}</span><div className="workbench-toolbar-actions">
                        <button type="button" title="关联作品图片" aria-label={`为${item.title}关联作品图片`} disabled={unavailable || !limit} onClick={() => props.onPick("project")}><BookOpen /></button>
                        <button type="button" title="从资产库选择" aria-label={`为${item.title}从资产库选择参考图`} disabled={unavailable || !limit} onClick={() => props.onPick("library")}><FolderOpen /></button>
                        <button type="button" title="从本地上传" aria-label={`为${item.title}上传参考图`} disabled={!canAdd} onClick={props.onUpload}><Upload /></button>
                    </div></div>
                    <div className="workbench-reference-grid">
                        <div className="comic-reference-entry comic-style-reference">
                            <div className="comic-style-reference-card">
                                <button type="button" className="comic-style-reference-select" aria-label={item.styleReference ? `更换${item.title}画风参考图` : `为${item.title}选择画风参考图`} disabled={unavailable} onClick={props.onStylePick}>
                                    {stylePreview ? <MediaPreview src={stylePreview} kind="image" alt="" /> : <><Plus aria-hidden /><span>选择画风图</span></>}
                                </button>
                                {item.styleReference ? <button type="button" className="comic-style-reference-remove" aria-label={`移除${item.title}画风参考图`} disabled={unavailable} onClick={props.onStyleRemove}><X /></button> : null}
                            </div>
                            <span className="comic-reference-name" title={item.styleReference?.title || "画风参考图"}>画风 · {item.styleReference?.title || "未选择"}</span>
                        </div>
                        {item.references.filter(reference => reference.source !== "style").map(reference => <div className="comic-reference-entry" key={reference.id}>
                            <ReferenceCard kind="image" reference={{ id: reference.id, name: reference.title, previewUrl: reference.previewUrl || "", kind: "image", role: "reference", progress: 100, uploading: false, error: reference.missing ? "参考图未就绪" : undefined }} disabled={unavailable || reference.source === "style"} errorLabel="未就绪" onPreview={() => props.onPreview(reference.title, reference.previewUrl)} onRemove={() => props.onRemove(reference.id)} />
                            <span className="comic-reference-name" title={`${referenceCaption(reference)} · ${reference.title}`}>{referenceCaption(reference)} · {reference.title}</span>
                        </div>)}
                        {canAdd ? <button type="button" className="workbench-reference-placeholder" onClick={() => props.onPick("library")} aria-label={`为${item.title}添加参考图`}><Plus aria-hidden /><span>添加参考图</span></button> : null}
                    </div>
                    {item.missingReferenceIds.length ? <p className="comic-muted">{item.missingReferenceIds.length} 项参考图未就绪，请先生成或重新选择。</p> : null}
                </div>
                {item.error ? <Callout tone="error" title={item.status === "failed" ? "生成未完成" : undefined} action={item.status === "failed" ? <Button size="small" disabled={!canGenerate} onClick={props.onGenerate}>重试</Button> : undefined}>{item.error}</Callout> : null}
            </div>
            <fieldset disabled={unavailable} className="workbench-composer-dock comic-generation-dock" aria-label={`${item.title}生成设置`}>
                <ModelPicker config={item.imageConfig} value={item.imageConfig.model} capability="image" fullWidth variant="creation" className="workbench-model-picker" showSelectedPrice={false} requirements={{ capability: "image", input: { textCount: 1, imageCount: item.references.length, referenceImageCount: item.references.length, videoCount: 0, audioCount: 0, characterCount: 0 } }} onChange={model => { if (!unavailable) props.onModel(model); }} />
                <button type="button" className="workbench-parameters-trigger" title={props.settingsSummary} aria-label={`调整${item.title}生图参数：${props.settingsSummary}`} onClick={props.onSettings}><SlidersHorizontal /><span>{props.settingsSummary}</span></button>
                <Button type="primary" className="workbench-submit" icon={<ImageIcon />} loading={running} disabled={!canGenerate} onClick={props.onGenerate}>{item.previewUrl ? "重新生成" : "生成"}</Button>
                <Button className="comic-batch-submit" disabled={props.batchDisabled || unavailable} onClick={props.onBatchGenerate}>{isPanel ? "生成就绪分镜" : "生成缺图"}</Button>
            </fieldset>
        </section>
    </article>;
}

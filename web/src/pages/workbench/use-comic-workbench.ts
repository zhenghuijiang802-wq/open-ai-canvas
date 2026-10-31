import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { App } from "antd";
import { createComicSourceNode, DEFAULT_COMIC_SETTINGS, getComicAssets, getComicPanels, getComicSource, type ComicSettings } from "@/lib/canvas/comic-workflow";
import { nodeGenerationPrompt, readNodeGenerationSpec } from "@/lib/canvas/generation-contract";
import { comicDefaultImageConfig, comicImageConfig, comicImageDefaults, rememberComicPromptStyle, removeComicStandaloneReference, updateComicImageConfig, updateComicImageReferences } from "@/lib/canvas/comic-image-editing";
import { appendComicStyleReference, selectedComicStyleReference, validateComicStyleSelection } from "@/lib/canvas/comic-style";
import { adoptMediaVersion, createNodeFromMediaVersion, ensureCurrentMediaVersion, mediaVersionAdoptBlock, removeMediaVersion } from "@/lib/canvas/canvas-media-versions";
import { createClientUUID } from "@/lib/client-id";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import { buildCanvasAgentMentionReferences } from "@/lib/canvas/canvas-resource-references";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { createCanvasProjectWithRemoteSync, loadCanvasProjectForEditing, prepareCanvasForCloudAction, saveRemoteUserDataNow, subscribeAgentCanvasRefresh } from "@/services/user-data-sync";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { ApiError } from "@/services/api/request";
import { queryGenerationTask, subscribeGenerationTasks } from "@/services/api/task-center";
import { resolveImageUrl } from "@/services/image-storage";
import { resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { assertComicImageEditable, comicReferenceIds, consumeComicTask, currentComicProject, recoverComicSubmissions, submitComicDerivation, submitComicImage } from "@/services/comic-workbench";
import { CanvasNodeType, type CanvasComicStyleSelection, type CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { Asset } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import { resolveWorkbenchAssetResource } from "./workbench-assets";

export type ComicWorkbenchReference = { id: string; title: string; previewUrl?: string; storageKey?: string; missing: boolean; source: "asset" | "upload" | "canvas" | "style"; assetKind?: "character" | "scene" | "prop" };

export type ComicWorkbenchItem = {
    id: string; title: string; prompt: string; previewUrl?: string; assetKind?: string;
    referenceAssetIds: string[]; missingReferenceIds: string[];
    status: "idle" | "running" | "succeeded" | "failed"; error?: string;
    node: CanvasNodeData; imageConfig: AiConfig; useUnifiedStyle: boolean; references: ComicWorkbenchReference[]; styleReference?: CanvasComicStyleSelection;
};

export function useComicWorkbench() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const projectId = searchParams.get("project") || "";
    const scope = getActiveUserScope();
    const config = useEffectiveConfig();
    const storedProjects = useCanvasStore((state) => state.projects);
    const [unavailableProjectIds, setUnavailableProjectIds] = useState<Set<string>>(() => new Set());
    const project = unavailableProjectIds.has(projectId) ? null : storedProjects.find((item) => item.id === projectId) || null;
    const source = project ? getComicSource(project.nodes) : undefined;
    const sourceComic = source?.metadata?.comic;
    const settings = sourceComic?.role === "source" ? sourceComic.settings : DEFAULT_COMIC_SETTINGS;
    const sourceText = source?.metadata?.content || "";
    const sourceFileName = sourceComic?.role === "source" ? sourceComic.sourceFileName : undefined;
    const [projects, setProjects] = useState<CanvasLibrarySummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [syncState, setSyncState] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [textModel, setTextModel] = useState("");
    const [previews, setPreviews] = useState<Record<string, string>>({});
    const busyRef = useRef(false);
    const projectIdRef = useRef(projectId);
    projectIdRef.current = projectId;
    const configRef = useRef(config);
    const textConfig = useMemo(() => ({ ...config, model: textModel || selectableModelsByCapability(config, "text")[0] || "" }), [config, textModel]);
    const imageConfig = useMemo(() => comicDefaultImageConfig(source, { ...config, model: selectableModelsByCapability(config, "image")[0] || "", size: settings.aspectRatio, count: "1" }), [config, source, settings.aspectRatio]);
    configRef.current = imageConfig;

    const report = useCallback((failure: unknown) => {
        const detail = failure instanceof Error ? failure.message : "操作未完成，请稍后重试";
        setError(detail);
        void message.error(detail);
    }, [message]);
    const run = useCallback(async (operation: () => Promise<void>) => {
        if (busyRef.current) throw new Error("正在处理上一个操作，请稍候");
        busyRef.current = true; setBusy(true); setError("");
        try { await operation(); } catch (failure) { report(failure); throw failure; }
        finally { busyRef.current = false; setBusy(false); }
    }, [report]);

    const refreshList = useCallback(async () => {
        const summaries: CanvasLibrarySummary[] = [];
        for (let page = 1; ; page++) {
            const result = await listRemoteCanvasProjectsPage({ page, pageSize: 100 });
            if (scope !== getActiveUserScope()) return;
            summaries.push(...result.projects.filter((item) => item.workflowKind === "comic"));
            if (!result.hasMore) break;
        }
        setProjects(summaries);
    }, [scope]);
    useEffect(() => { void refreshList().catch(report); }, [refreshList, report]);
    useEffect(() => {
        if (!projectId) { setLoading(false); setSelectedId(""); setSyncState(""); return; }
        let active = true;
        let projectLoaded = false;
        const isCurrent = () => active && projectIdRef.current === projectId && scope === getActiveUserScope();
        setLoading(true); setError(""); setSelectedId(""); setPreviews({});
        void loadCanvasProjectForEditing(projectId).then(async (loaded) => {
            if (!isCurrent()) return;
            projectLoaded = true;
            if (!loaded || !getComicSource(loaded.nodes)) throw new Error("该画布不是漫画作品，请选择漫画作品或新建");
            setUnavailableProjectIds((current) => { if (!current.has(projectId)) return current; const next = new Set(current); next.delete(projectId); return next; });
            await recoverComicSubmissions(projectId);
        }).catch((failure) => {
            if (!isCurrent()) return;
            if (!projectLoaded && failure instanceof ApiError && (failure.status === 403 || failure.status === 404)) {
                setUnavailableProjectIds((current) => new Set([...current, projectId]));
                setError("该作品不存在或当前账号无权访问，请选择已有作品或新建。");
                setLoading(false);
                setSearchParams((current) => {
                    if (current.get("project") !== projectId) return current;
                    const next = new URLSearchParams(current);
                    next.delete("project");
                    return next;
                }, { replace: true });
                return;
            }
            report(failure);
        }).finally(() => { if (isCurrent()) setLoading(false); });
        return () => { active = false; };
    }, [projectId, scope, report, setSearchParams]);

    const imageNodes = useMemo(() => project ? [...getComicAssets(project.nodes), ...getComicPanels(project.nodes)] : [], [project]);
    const mediaNodes = project?.nodes.filter((node) => node.type === CanvasNodeType.Image) || [];
    const standaloneReferences = imageNodes.flatMap((node) => readNodeGenerationSpec(node)?.referenceBindings.filter((binding) => !binding.nodeId && binding.resourceId && binding.mediaType === "image" && binding.role !== "source-text") || []);
    const styleResourceIds = [...new Set(imageNodes.map((node) => selectedComicStyleReference(node, source)?.referenceResourceId).filter((id): id is string => Boolean(id)))];
    const previewSignature = JSON.stringify([scope, projectId, mediaNodes.map((node) => [node.id, node.metadata?.storageKey, node.metadata?.content]), standaloneReferences.map((binding) => [binding.id, binding.resourceId]), styleResourceIds]);
    useEffect(() => {
        let active = true;
        void Promise.all([
            ...mediaNodes.map(async (node) => [node.id, await resolveImageUrl(node.metadata?.storageKey, node.metadata?.content)] as const),
            ...standaloneReferences.map(async (binding) => [binding.id, await resolveImageUrl(resourceStorageKey(binding.resourceId!))] as const),
            ...styleResourceIds.map(async (id) => [`comic-style:${id}`, await resolveImageUrl(resourceStorageKey(id))] as const),
        ])
            .then((entries) => { if (active) setPreviews(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))); })
            .catch((failure) => { if (active) report(failure); });
        return () => { active = false; };
    // Only media identity should trigger resource resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewSignature, report]);

    const taskIds = JSON.stringify([...new Set([
        ...(sourceComic?.role === "source" && sourceComic.derivationTaskId && !["succeeded", "failed"].includes(sourceComic.derivationStatus || "") ? [sourceComic.derivationTaskId] : []),
        ...imageNodes.filter((node) => node.metadata?.taskId && node.metadata.status !== "success" && node.metadata.taskStatus !== "failed" && node.metadata.taskStatus !== "cancelled").map((node) => node.metadata!.taskId!),
    ])].sort());
    useEffect(() => {
        if (!projectId || loading) return;
        let active = true;
        let tail = Promise.resolve();
        const unsubscribe = subscribeGenerationTasks(JSON.parse(taskIds) as string[], (task) => {
            tail = tail.then(async () => {
                if (!active || scope !== getActiveUserScope()) return;
                await consumeComicTask(projectId, task, configRef.current);
            }).catch((failure) => { if (active) report(failure); });
        });
        return () => { active = false; unsubscribe(); };
    }, [projectId, loading, taskIds, scope, report]);

    useEffect(() => {
        if (!project || !source) return;
        const previous = useGlobalAgentStore.getState().canvas;
        useGlobalAgentStore.getState().setCanvas({ canvasId: project.id, domainProjectId: project.projectId, nodeCount: project.nodes.length,
            prefillRequest: previous?.canvasId === project.id ? previous.prefillRequest : undefined,
            selectedNodeIds: selectedId ? [selectedId] : [source.id], references: buildCanvasAgentMentionReferences(project.nodes), canvasNodes: project.nodes, onFocusNode: setSelectedId });
    }, [project, source, selectedId]);
    useEffect(() => () => { if (useGlobalAgentStore.getState().canvas?.canvasId === projectId) useGlobalAgentStore.getState().setCanvas(null); }, [projectId]);
    useEffect(() => subscribeAgentCanvasRefresh((updated) => {
        if (updated.id === projectId) setSyncState("AI 修改已同步");
    }), [projectId]);

    const persist = useCallback(async (id: string) => {
        if (!id || unavailableProjectIds.has(id)) throw new Error("请先选择可访问的漫画作品或新建作品");
        if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新打开作品");
        const isCurrent = () => projectIdRef.current === id && scope === getActiveUserScope();
        if (isCurrent()) setSyncState("正在保存…");
        try { await saveRemoteUserDataNow(id); if (isCurrent()) setSyncState("已保存到影策"); }
        catch (failure) { if (isCurrent()) setSyncState("已保留本地修改，云端保存未完成"); throw failure; }
    }, [scope, unavailableProjectIds]);
    const editableProject = () => {
        if (!projectId || unavailableProjectIds.has(projectId) || projectIdRef.current !== projectId || scope !== getActiveUserScope()) throw new Error("作品或账号已切换，请重新打开后操作");
        return currentComicProject(projectId);
    };
    const editableNode = (id: string) => {
        const current = editableProject();
        const node = current.nodes.find((entry) => entry.id === id);
        if (!node || !["asset", "panel"].includes(node.metadata?.comic?.role || "")) throw new Error("资产或分镜已不存在");
        if (node.metadata?.locked) throw new Error("节点已锁定，请先在画布中解锁");
        if (node.metadata?.status === "loading") throw new Error("生成或提交确认进行中，请等待完成后调整");
        return { current, node };
    };
    // Older media can predate version tracking. Register it once so the native
    // version modal uses stable persisted version IDs, including before regen.
    useEffect(() => {
        if (!project || loading || unavailableProjectIds.has(projectId) || scope !== getActiveUserScope()) return;
        const nodes = project.nodes.map((node) => ["asset", "panel"].includes(node.metadata?.comic?.role || "") ? ensureCurrentMediaVersion(node) : node);
        if (!nodes.some((node, index) => node !== project.nodes[index])) return;
        useCanvasStore.getState().updateProject(projectId, { nodes });
        setSyncState("修改已缓存，等待保存");
    }, [project, projectId, loading, scope, unavailableProjectIds]);
    const editSource = (patch: { content?: string; settings?: ComicSettings; sourceFileName?: string }) => {
        if (!project || !source || sourceComic?.role !== "source") return;
        if (sourceComic.derivationStatus === "running" || sourceComic.derivationStatus === "pending") { report(new Error("推导进行中，请等待结果后再修改原文")); return; }
        const current = currentComicProject(project.id);
        const currentSource = getComicSource(current.nodes)!;
        const currentComic = currentSource.metadata.comic;
        if (patch.settings?.styleSelection) {
            try { validateComicStyleSelection(patch.settings.styleSelection); }
            catch (failure) { report(failure); return; }
        }
        useCanvasStore.getState().updateProject(project.id, { nodes: current.nodes.map((node) => node.id === source.id ? { ...node, metadata: { ...node.metadata, ...(patch.content !== undefined ? { content: patch.content } : {}), comic: { ...currentComic, ...(patch.settings ? { settings: patch.settings } : {}), ...(patch.sourceFileName !== undefined ? { sourceFileName: patch.sourceFileName } : {}) } } } : patch.settings ? rememberComicPromptStyle(node, currentComic.settings.style) : node) });
        setSyncState("修改已缓存，等待保存");
    };
    useEffect(() => {
        if (!projectId || syncState !== "修改已缓存，等待保存") return;
        const timer = setTimeout(() => { void persist(projectId).catch(report); }, 800);
        return () => clearTimeout(timer);
    }, [projectId, sourceText, sourceFileName, settings, syncState, persist, report]);

    const item = (node: CanvasNodeData): ComicWorkbenchItem => {
        const ids = project ? comicReferenceIds(node, project) : [];
        const references: ComicWorkbenchReference[] = ids.map((id) => {
            const reference = project?.nodes.find((entry) => entry.id === id);
            const assetKind = reference?.metadata?.comic?.role === "asset" ? reference.metadata.comic.assetKind : undefined;
            return { id, title: reference?.title || "引用图片不存在", previewUrl: previews[id], storageKey: reference?.metadata?.storageKey, missing: !reference || !(reference.metadata?.storageKey || reference.metadata?.content) || reference.metadata?.status === "loading", source: assetKind ? "asset" : reference?.metadata?.assetId ? "canvas" : "upload", ...(assetKind ? { assetKind } : {}) };
        });
        for (const binding of [...(readNodeGenerationSpec(node)?.referenceBindings || [])].sort((left, right) => left.order - right.order)) {
            if (binding.nodeId || binding.role === "source-text") continue;
            references.push({ id: binding.id, title: "画布参考图", previewUrl: previews[binding.id], storageKey: binding.resourceId ? resourceStorageKey(binding.resourceId) : undefined, missing: !binding.resourceId || Boolean(binding.transientId) || binding.mediaType !== "image" || binding.role !== "reference", source: "canvas" });
        }
        const styled = appendComicStyleReference(node, source, references.map((reference) => ({ id: reference.id, name: reference.title, dataUrl: project?.nodes.find((entry) => entry.id === reference.id)?.metadata?.content || "", storageKey: reference.storageKey, type: "image/png" })));
        if (styled.styleAdded) {
            const reference = styled.references[styled.styleIndex];
            references.push({ id: reference.id, title: reference.name, previewUrl: previews[reference.id] || reference.url, storageKey: reference.storageKey, missing: false, source: "style" });
        } else if (styled.styleIndex >= 0) {
            references[styled.styleIndex] = { ...references[styled.styleIndex], title: `${references[styled.styleIndex].title} · 同时用于画风` };
        }
        return { id: node.id, title: node.title, prompt: nodeGenerationPrompt(node), previewUrl: previews[node.id],
            node, imageConfig: comicImageConfig(node, imageConfig), useUnifiedStyle: node.metadata?.comic?.role !== "source" && node.metadata?.comic?.useUnifiedStyle !== false, references, styleReference: selectedComicStyleReference(node, source),
            assetKind: node.metadata?.comic?.role === "asset" ? node.metadata.comic.assetKind : undefined, referenceAssetIds: ids,
            missingReferenceIds: references.filter((entry) => entry.missing).map((entry) => entry.id),
            status: node.metadata?.status === "loading" ? node.metadata.taskId ? "running" : "failed" : node.metadata?.status === "success" ? "succeeded" : node.metadata?.status === "error" ? "failed" : "idle",
            error: node.metadata?.status === "loading" && !node.metadata.taskId ? "提交结果尚未确认，请刷新任务状态；不会重复提交生成" : node.metadata?.errorDetails };
    };
    const assets = project ? getComicAssets(project.nodes).map(item) : [];
    const panels = project ? getComicPanels(project.nodes).map(item) : [];
    const generateMany = (role: "asset" | "panel") => run(async () => {
        const current = editableProject();
        const nodes = role === "asset" ? getComicAssets(current.nodes) : getComicPanels(current.nodes);
        let skipped = 0;
        for (const node of nodes) {
            if (node.metadata?.status === "success" || (node.metadata?.status === "loading" && node.metadata.taskId)) continue;
            const latest = currentComicProject(projectId);
            if (comicReferenceIds(node, latest).some((id) => !latest.nodes.some((asset) => asset.id === id && (asset.metadata?.storageKey || asset.metadata?.content) && asset.metadata.status !== "loading"))) { skipped++; continue; }
            await submitComicImage(projectId, node.id, imageConfig);
        }
        setSyncState(skipped ? `已提交就绪项，${skipped} 个分镜等待参考资产` : "生成任务已提交，可在任务中心查看");
    });

    const updateDefaultImageConfig = (next: AiConfig) => run(async () => {
        const current = editableProject();
        const currentSource = getComicSource(current.nodes)!;
        const comic = currentSource.metadata.comic;
        if (["pending", "running"].includes(comic.derivationStatus || "")) throw new Error("推导进行中，请等待完成后调整参数");
        useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map((node) => node.id === currentSource.id ? {
            ...node, metadata: { ...node.metadata, comic: { ...comic, settings: { ...comic.settings, imageDefaults: comicImageDefaults(next) } } },
        } : node) });
        await persist(projectId);
    });
    const changeReferences = (id: string, ids: string[]) => {
        const { current } = editableNode(id);
        useCanvasStore.getState().updateProject(projectId, updateComicImageReferences(current, id, ids));
    };
    const admitReferences = (id: string, count: number, files: File[] = [], known: ReferenceImage[] = []) => {
        const { current, node } = editableNode(id);
        const selected = comicImageConfig(node, imageConfig);
        const profile = mergedImageCapabilityConfig(selected, selected.model);
        const ordinary = [
            ...comicReferenceIds(node, current).map((referenceId) => { const reference = current.nodes.find((entry) => entry.id === referenceId); return { id: referenceId, name: reference?.title || "参考图", storageKey: reference?.metadata?.storageKey, dataUrl: reference?.metadata?.content || "", type: "image/png" }; }),
            ...(readNodeGenerationSpec(node)?.referenceBindings.filter((binding) => !binding.nodeId && binding.role !== "source-text").map((binding) => ({ id: binding.id, name: "画布参考图", storageKey: binding.resourceId ? resourceStorageKey(binding.resourceId) : undefined, dataUrl: "", type: "image/png" })) || []),
        ];
        // Resolve known inputs before appending the style image: the same resource
        // may serve both purposes and must occupy only one generation input.
        const combined = [...ordinary, ...known.filter((reference, index) => !ordinary.some((existing) => existing.id === reference.id) && known.findIndex((entry) => entry.id === reference.id) === index)];
        const existing = appendComicStyleReference(node, getComicSource(current.nodes), combined).references.length;
        if (profile.references.maxImages <= 0) throw new Error("当前模型不支持参考图，请在生图参数中选择支持参考图的模型");
        if (existing + count > profile.references.maxImages) throw new Error(`当前模型最多支持 ${profile.references.maxImages} 张参考图，请移除部分参考图或更换模型`);
        if (files.some((file) => !file.type.startsWith("image/"))) throw new Error("请选择图片文件");
        if (profile.references.maxImageBytes > 0 && files.some((file) => file.size > profile.references.maxImageBytes)) throw new Error(`参考图大小超过当前模型的限制（${Math.floor(profile.references.maxImageBytes / 1024 / 1024)} MB）`);
    };
    const attachResource = (id: string, resource: { id: string; kind: string; status: string; width?: number; height?: number; mimeType?: string; size?: number }, title: string, assetId?: string) => {
        const { current, node } = editableNode(id);
        if (!resource.id || resource.kind !== "image" || resource.status !== "ready") throw new Error("图片资源尚未就绪，请重试上传");
        const key = resourceStorageKey(resource.id);
        const existingNode = current.nodes.find((entry) => entry.id !== id && entry.type === CanvasNodeType.Image && entry.metadata?.storageKey === key);
        if (existingNode) {
            const refs = comicReferenceIds(node, current);
            if (!refs.includes(existingNode.id)) { admitReferences(id, 0, [], [{ id: existingNode.id, name: title, storageKey: key, dataUrl: "", type: "image/png" }]); changeReferences(id, [...refs, existingNode.id]); }
            return;
        }
        admitReferences(id, 0, [], [{ id: `resource:${resource.id}`, name: title, storageKey: key, dataUrl: "", type: "image/png" }]);
        const now = new Date().toISOString();
        const reference: CanvasNodeData = ensureCurrentMediaVersion({
            id: `image-${createClientUUID()}`, type: CanvasNodeType.Image, title: title.trim().slice(0, 200) || "参考图", createdAt: now, updatedAt: now,
            position: { x: node.position.x - 400, y: node.position.y + comicReferenceIds(node, current).length * 40 },
            width: 320, height: resource.width && resource.height ? 320 * resource.height / resource.width : 320,
            metadata: { storageKey: key, status: "success", naturalWidth: resource.width, naturalHeight: resource.height, mimeType: resource.mimeType, bytes: resource.size, ...(assetId ? { assetId } : {}) },
        }, { source: "upload" });
        const next = { ...current, nodes: [...current.nodes, reference] };
        useCanvasStore.getState().updateProject(projectId, updateComicImageReferences(next, id, [...comicReferenceIds(node, current), reference.id]));
    };
    const editVersion = async (id: string, versionId: string, action: "adopt" | "delete" | "extract"): Promise<boolean> => {
        let changed = false;
        await run(async () => {
            editableNode(id);
            await assertComicImageEditable(projectId, id);
            const { current, node } = editableNode(id);
            const block = mediaVersionAdoptBlock(node);
            if (block) throw new Error("图片正在生成、上传或已锁定，暂时无法编辑版本");
            if (action === "extract") {
                const extracted = createNodeFromMediaVersion(node, versionId, `image-${createClientUUID()}`);
                if (!extracted) throw new Error("这个版本的图片已不可用");
                if (extracted.metadata) delete extracted.metadata.comic;
                useCanvasStore.getState().updateProject(projectId, { nodes: [...current.nodes, extracted] });
            } else {
                const next = action === "adopt" ? adoptMediaVersion(node, versionId) : removeMediaVersion(node, versionId);
                if (!next) throw new Error(action === "adopt" ? "这个版本的图片已不可用" : "当前版本不能删除");
                useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map((entry) => entry.id === id ? next : entry) });
            }
            await persist(projectId);
            changed = true;
            if (action === "extract") void message.success("已另存到原画布，可从作品图片中选作参考图");
        });
        return changed;
    };

    return {
        project, projects: [...new Map([...projects, ...storedProjects.filter((entry) => getComicSource(entry.nodes))].filter((entry) => !unavailableProjectIds.has(entry.id)).map((entry) => [entry.id, entry])).values()],
        sourceText, sourceFileName, settings, assets, panels, loading,
        referenceCandidates: mediaNodes.map((node) => ({ id: node.id, title: node.title, previewUrl: previews[node.id], assetKind: node.metadata?.comic?.role === "asset" ? node.metadata.comic.assetKind : undefined, missing: !(node.metadata?.storageKey || node.metadata?.content) || node.metadata?.status === "loading" })),
        busy: busy || sourceComic?.role === "source" && sourceComic.derivationStatus === "running",
        error: error || (sourceComic?.role === "source" ? sourceComic.derivationError || "" : ""), syncState, selectedId, setSelectedId,
        textConfig, imageConfig, textModel: textConfig.model, imageModel: imageConfig.model, setTextModel,
        setImageModel: (model: string) => updateDefaultImageConfig({ ...imageConfig, model }),
        updateDefaultImageConfig,
        updateImageConfig: (id: string, next: AiConfig) => run(async () => {
            const { current, node } = editableNode(id);
            const updated = updateComicImageConfig(node, next);
            useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map((entry) => entry.id === id ? updated : entry) });
            await persist(projectId);
        }),
        setStyleReference: (id: string, selection: CanvasComicStyleSelection | null) => run(async () => {
            if (selection) validateComicStyleSelection(selection);
            if (selection && !selection.referenceResourceId && !selection.coverUrl?.startsWith("/comic-style-previews/")) throw new Error("该画风没有参考图片，请先上传画风图片");
            const { current, node } = editableNode(id);
            const comic = node.metadata?.comic;
            if (!comic || comic.role === "source") throw new Error("请选择资产或分镜");
            useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map(entry => entry.id === id ? { ...node, metadata: { ...node.metadata, comic: { ...comic, styleReference: selection } } } : entry) });
            await persist(projectId);
        }),
        setNodeUnifiedStyle: (id: string, checked: boolean) => run(async () => {
            const { current, node } = editableNode(id);
            const remembered = rememberComicPromptStyle(node, getComicSource(current.nodes)!.metadata.comic.settings.style);
            const comic = remembered.metadata?.comic;
            if (!comic || comic.role === "source") throw new Error("请选择资产或分镜");
            useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map((entry) => entry.id === id ? { ...remembered, metadata: { ...remembered.metadata, comic: { ...comic, useUnifiedStyle: checked } } } : entry) });
            await persist(projectId);
        }),
        uploadReferenceFiles: (id: string, files: File[]) => run(async () => {
            if (!files.length) return;
            admitReferences(id, files.length, files);
            for (const [index, file] of files.entries()) {
                editableNode(id);
                setSyncState(`正在上传参考图 ${index + 1}/${files.length}…`);
                const resource = await uploadResourceFile(file, "image", { fileName: file.name });
                attachResource(id, resource, file.name);
                await persist(projectId);
            }
        }),
        addLibraryReferences: (id: string, selected: Asset[]) => run(async () => {
            if (!selected.length) return;
            if (selected.some((asset) => asset.kind !== "image")) throw new Error("请选择图片资产");
            const resolved = [];
            for (const asset of selected) {
                if (asset.kind !== "image") continue;
                editableNode(id);
                setSyncState("正在添加资产库参考图…");
                const resource = await resolveWorkbenchAssetResource(asset);
                resolved.push({ asset, resource });
            }
            const { current } = editableNode(id);
            admitReferences(id, 0, [], resolved.map(({ asset, resource }) => {
                const key = resourceStorageKey(resource.id);
                const existing = current.nodes.find((entry) => entry.id !== id && entry.type === CanvasNodeType.Image && entry.metadata?.storageKey === key);
                return { id: existing?.id || `resource:${resource.id}`, name: asset.title, storageKey: key, dataUrl: "", type: "image/png" };
            }));
            for (const { asset, resource } of resolved) attachResource(id, { ...resource, width: asset.data.width, height: asset.data.height, mimeType: asset.data.mimeType, size: asset.data.bytes }, asset.title, asset.id);
            await persist(projectId);
        }),
        addReferenceNodes: (id: string, sourceIds: string[]) => run(async () => {
            const { current, node } = editableNode(id);
            const ids = comicReferenceIds(node, current);
            const additions = [...new Set(sourceIds)].filter((entry) => !ids.includes(entry));
            admitReferences(id, 0, [], additions.map((referenceId) => {
                const reference = current.nodes.find((entry) => entry.id === referenceId);
                return { id: referenceId, name: reference?.title || "参考图", storageKey: reference?.metadata?.storageKey, dataUrl: reference?.metadata?.content || "", type: "image/png" };
            }));
            changeReferences(id, [...ids, ...additions]);
            await persist(projectId);
        }),
        removeReference: (id: string, sourceId: string) => run(async () => {
            const { current, node } = editableNode(id);
            if (sourceId.startsWith("comic-style:")) throw new Error("画风参考由统一画风开关控制，请关闭统一画风或选择其他画风");
            const ids = comicReferenceIds(node, current);
            if (ids.includes(sourceId)) changeReferences(id, ids.filter((entry) => entry !== sourceId));
            else useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map((entry) => entry.id === id ? removeComicStandaloneReference(entry, sourceId, ids) : entry) });
            await persist(projectId);
        }),
        adoptVersion: (id: string, versionId: string) => editVersion(id, versionId, "adopt"),
        deleteVersion: (id: string, versionId: string) => editVersion(id, versionId, "delete"),
        extractVersion: (id: string, versionId: string) => editVersion(id, versionId, "extract"),
        clearError: () => setError(""), setSourceText: (content: string) => editSource({ content }), importSourceText: (content: string, sourceFileName: string) => editSource({ content, sourceFileName }), setSettings: (value: ComicSettings) => editSource({ settings: value }),
        save: () => run(() => persist(projectId)),
        recover: () => run(async () => {
            await recoverComicSubmissions(projectId);
            const current = currentComicProject(projectId);
            const sourceState = getComicSource(current.nodes)?.metadata.comic;
            const ids = [...current.nodes.flatMap((node) => node.metadata?.taskId ? [node.metadata.taskId] : []), ...(sourceState?.derivationTaskId ? [sourceState.derivationTaskId] : [])];
            for (const id of new Set(ids)) await consumeComicTask(projectId, await queryGenerationTask(id), configRef.current);
            await persist(projectId);
        }),
        openProject: async (id: string) => { if (projectId) await run(() => persist(projectId)); setSearchParams({ project: id }); },
        createProject: () => run(async () => {
            const node = createComicSourceNode("", DEFAULT_COMIC_SETTINGS);
            const result = await createCanvasProjectWithRemoteSync(`漫画 · ${new Date().toLocaleDateString("zh-CN")}`, undefined, { nodes: [node], connections: [], chatSessions: [], activeChatId: null });
            setSearchParams({ project: result.id });
            if (result.syncError) throw result.syncError;
            await persist(result.id); await refreshList();
        }),
        derive: () => run(async () => { await submitComicDerivation(projectId, textConfig); setSyncState("正在推导资产和分镜提示词…"); }),
        updatePrompt: (id: string, prompt: string) => run(async () => {
            const { current, node } = editableNode(id);
            const remembered = rememberComicPromptStyle(node, getComicSource(current.nodes)!.metadata.comic.settings.style);
            useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map((entry) => entry.id === id ? writeCanvasNodePrompt(remembered, prompt) : entry) });
            await persist(projectId);
        }),
        renameNode: (id: string, title: string) => run(async () => {
            if (!title.trim() || title.length > 200) throw new Error("名称需为 1–200 字");
            const { current } = editableNode(id);
            useCanvasStore.getState().updateProject(projectId, { nodes: current.nodes.map((node) => node.id === id ? { ...node, title: title.trim() } : node) });
            await persist(projectId);
        }),
        generateNode: (id: string) => run(async () => { editableNode(id); await submitComicImage(projectId, id, imageConfig); setSyncState("生成任务已提交"); }),
        generateAssets: () => generateMany("asset"), generatePanels: () => generateMany("panel"),
        refineNode: (id: string, instruction = "在保留原剧情、角色设定和参考资产关联的基础上，细化这个节点的生图提示词。请先读取原文与节点，再使用现有画布工具更新这个节点的提示词，不生成图片。") => run(async () => {
            if (!projectId || unavailableProjectIds.has(projectId)) throw new Error("请先选择可访问的漫画作品或新建作品");
            await prepareCanvasForCloudAction(projectId);
            if (projectIdRef.current !== projectId || getActiveUserScope() !== scope) return;
            const current = currentComicProject(projectId);
            setSelectedId(id);
            const global = useGlobalAgentStore.getState();
            global.setCanvas({ canvasId: current.id, domainProjectId: current.projectId, nodeCount: current.nodes.length, selectedNodeIds: [id], references: buildCanvasAgentMentionReferences(current.nodes), canvasNodes: current.nodes,
                prefillRequest: { id: Date.now(), text: `${instruction}\n目标节点：${id}`, autoSubmit: false }, onFocusNode: setSelectedId });
            global.openAgent();
        }),
    };
}

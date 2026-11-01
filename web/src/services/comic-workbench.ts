import { createClientUUID } from "@/lib/client-id";
import { getActiveUserScope } from "@/lib/user-scope";
import { buildComicDerivationPrompt, buildComicNodes, getComicAssets, getComicPanels, getComicSource, parseComicDerivation } from "@/lib/canvas/comic-workflow";
import { bindingForNode, generationSpecMetadata, nodeGenerationPrompt, readNodeGenerationSpec, specFromConfig } from "@/lib/canvas/generation-contract";
import { comicNodeTaskKey, comicSourceStateKey, comicTaskMatches } from "@/lib/canvas/comic-task-state";
import { comicImageConfig, comicImagePrompt, comicImageReferenceIds, normalizeComicImagePromptReferences } from "@/lib/canvas/comic-image-editing";
import { appendComicStyleReference, comicStyleReferenceInstruction } from "@/lib/canvas/comic-style";
import { assertCanvasImageReferenceLimit, generationTaskMetadata, nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";
import { syncGenerationTaskToCanvasStore } from "@/lib/canvas/canvas-generation-task-sync";
import { mediaVersionFieldsBeforeReplace } from "@/lib/canvas/canvas-media-versions";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-task-state";
import { modelCompatibilityError } from "@/lib/model-selection";
import { parseBackendGenerationResult, prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createGenerationTask, listGenerationTasks, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { ApiError } from "@/services/api/request";
import { resourceStorageKey } from "@/services/api/resources";
import { prepareCanvasForCloudAction, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

export function currentComicProject(id: string) {
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (!project || !getComicSource(project.nodes)) throw new Error("漫画作品不存在，请重新打开作品");
    return project;
}

export function comicReferenceIds(node: CanvasNodeData, project: CanvasProject) {
    return comicImageReferenceIds(node, project);
}

function sessionGuard() {
    const scope = getActiveUserScope();
    return () => { if (scope !== getActiveUserScope()) throw new Error("账号已切换，已停止更新原作品"); };
}

function patchNode(projectId: string, nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) {
    const project = currentComicProject(projectId);
    if (!project.nodes.some((node) => node.id === nodeId)) throw new Error("该节点已被删除");
    useCanvasStore.getState().updateProject(projectId, { nodes: project.nodes.map((node) => node.id === nodeId ? update(node) : node) });
}

async function sourceFingerprint(source: CanvasNodeData) {
    const input = comicSourceStateKey(source);
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const uncertainSubmission = "上次提交尚未确认。请刷新任务状态或到任务中心查询原任务；为避免重复计费，暂不重复提交。";
function definiteRejection(error: unknown): error is ApiError {
    return error instanceof ApiError && error.status !== undefined && [400, 401, 403, 404, 409, 413, 422, 429].includes(error.status);
}

function patchSourceTask(projectId: string, sourceId: string, operationId: string, patch: Record<string, unknown>) {
    patchNode(projectId, sourceId, (node) => {
        const current = node.metadata?.comic;
        if (current?.role !== "source" || current.derivationOperationId !== operationId) throw new Error("推导请求已变化，未覆盖新请求");
        return { ...node, metadata: { ...node.metadata, comic: { ...current, ...patch } } };
    });
}

async function rejectUncertainTask(task: GenerationTask) {
    if (task.status === "queued" || task.status === "running") throw new Error("原任务正在进行，请等待完成");
    if (task.providerCancelStatus === "uncertain" || task.canRecoverMedia || task.resultState === "PENDING_MATERIALIZATION" || task.resultState === "MATERIALIZING") throw new Error("原任务仍可恢复或结算待确认，请先在任务中心查询原任务，避免重复生成");
    // Detail responses omit billing; use the summary before authorizing a new charged attempt.
    let billing = task.billing;
    if (task.status === "failed" || task.status === "cancelled") {
        const summary = (await listGenerationTasks(100, { projectId: task.projectId })).find((item) => item.id === task.id);
        if (!summary) throw new Error("无法核对原任务结算状态，请到任务中心查询或重试原任务");
        billing = summary.billing;
    }
    if (billing && !["settled", "refunded"].includes(billing.status)) {
        throw new Error("原任务仍可恢复或结算待确认，请先在任务中心查询原任务，避免重复生成");
    }
}

/** Version adoption clears task receipts, so verify the old charge before any media edit. */
export async function assertComicImageEditable(projectId: string, nodeId: string): Promise<void> {
    const guard = sessionGuard();
    const node = currentComicProject(projectId).nodes.find((item) => item.id === nodeId);
    if (!node || !["asset", "panel"].includes(node.metadata?.comic?.role || "")) throw new Error("请选择漫画资产或分镜");
    if (node.metadata?.locked) throw new Error("节点已锁定，请先在画布中解锁");
    if (node.metadata?.fileUpload === "uploading") throw new Error("图片正在上传，请等待完成");
    if (!node.metadata?.taskId && node.metadata?.taskClientOperationId) throw new Error(uncertainSubmission);
    const key = comicNodeTaskKey(node);
    if (node.metadata?.taskId) {
        const task = await queryGenerationTask(node.metadata.taskId);
        guard();
        await rejectUncertainTask(task);
        guard();
        if (task.status === "succeeded" && node.metadata.status !== "success") throw new Error("原任务已完成，请先恢复原任务结果");
    } else if (node.metadata?.status === "loading") throw new Error("图片正在生成，请等待完成");
    const current = currentComicProject(projectId).nodes.find((item) => item.id === nodeId);
    if (!current || comicNodeTaskKey(current) !== key || current.metadata?.locked || current.metadata?.fileUpload === "uploading") throw new Error("节点已被其他操作修改，请重新确认");
}

function comicSubmissionReferences(node: CanvasNodeData, project: CanvasProject) {
    const storedBindings = readNodeGenerationSpec(node)?.referenceBindings || [];
    if (storedBindings.some((binding) => binding.role !== "source-text" && (binding.mediaType !== "image" || binding.role !== "reference"))) throw new Error("此节点包含非图片或遮罩生成引用，请在原画布调整后再生成");
    const referenceIds = comicReferenceIds(node, project);
    const references: ReferenceImage[] = referenceIds.map((id) => {
        const asset = project.nodes.find((item) => item.id === id);
        if (!asset || asset.metadata?.status === "loading" || asset.metadata?.fileUpload === "uploading") throw new Error(`参考图尚未就绪：${asset?.title || id}`);
        const reference = nodeReferenceImage(asset);
        if (!reference) throw new Error(`请先生成或上传参考图：${asset.title}`);
        return { ...reference, name: asset.title || reference.name };
    });
    const standalone = storedBindings.filter((binding) => !binding.nodeId && binding.role !== "source-text").sort((a, b) => a.order - b.order);
    for (const binding of standalone) {
        if (!binding.resourceId || binding.transientId || binding.mediaType !== "image" || binding.role !== "reference") throw new Error("存在尚未保存或不支持的参考素材，请重新选择参考图");
        references.push({ id: binding.id, name: `参考图 ${references.length + 1}`, type: "image/png", storageKey: resourceStorageKey(binding.resourceId), dataUrl: "" });
    }
    const bindings = [
        ...referenceIds.map((id, index) => bindingForNode(project.nodes.find((item) => item.id === id)!, index)!),
        ...standalone.map((binding, index) => ({ ...binding, order: referenceIds.length + index })),
        ...storedBindings.filter((binding) => binding.role === "source-text").map((binding, index) => ({ ...binding, order: referenceIds.length + standalone.length + index })),
    ];
    const styled = appendComicStyleReference(node, getComicSource(project.nodes), references);
    return { ...styled, bindings };
}

function comicImageInputKey(node: CanvasNodeData, project: CanvasProject) {
    const { references, bindings, styleIndex, styleAdded } = comicSubmissionReferences(node, project);
    return JSON.stringify([comicImagePrompt(node, getComicSource(project.nodes)), references.map((reference) => [reference.id, reference.storageKey, reference.dataUrl, reference.url]), bindings, styleIndex, styleAdded]);
}

export async function submitComicDerivation(projectId: string, config: AiConfig) {
    const guard = sessionGuard();
    let project = currentComicProject(projectId);
    if (getComicAssets(project.nodes).length || getComicPanels(project.nodes).length) throw new Error("当前作品已有资产或分镜，请新建作品后重新推导");
    const source = getComicSource(project.nodes)!;
    const comic = source.metadata!.comic!;
    if (comic.role !== "source") throw new Error("原文节点无效");
    if (comic.derivationStatus === "pending" && comic.derivationOperationId && !comic.derivationTaskId) {
        await recoverComicSubmissions(projectId); guard();
        const recovered = getComicSource(currentComicProject(projectId).nodes)!.metadata.comic;
        if (recovered.derivationTaskId) return queryGenerationTask(recovered.derivationTaskId);
        throw new Error(uncertainSubmission);
    }
    const sourceKey = comicSourceStateKey(source);
    const prompt = buildComicDerivationPrompt(source.metadata?.content || "", comic.settings);
    if (!config.model) throw new Error("请选择用于推导的文本模型");
    if (comic.derivationTaskId) {
        const existing = await queryGenerationTask(comic.derivationTaskId);
        guard();
        if (existing.status === "succeeded" && comic.derivationStatus !== "failed") return existing;
        await rejectUncertainTask(existing); guard();
    }
    const fingerprint = await sourceFingerprint(source);
    guard();
    const operationId = createClientUUID();
    const input = await prepareBackendGenerationTask({ projectId, mode: "text", prompt, config, clientOperationId: operationId, metadata: { comicSourceNodeId: source.id }, streamText: true });
    guard();
    patchNode(projectId, source.id, (node) => {
        if (comicSourceStateKey(node) !== sourceKey || node.metadata?.comic?.role !== "source" || node.metadata.comic.derivationOperationId !== comic.derivationOperationId) throw new Error("原文或推导请求已变化，请重新确认");
        return { ...node, metadata: { ...node.metadata, comic: { ...node.metadata.comic, derivationOperationId: operationId, derivationFingerprint: fingerprint, derivationTaskId: undefined, derivationStatus: "pending", derivationError: undefined } } };
    });
    try {
        await prepareCanvasForCloudAction(projectId); guard();
        const ready = getComicSource(currentComicProject(projectId).nodes)!;
        if (comicSourceStateKey(ready) !== sourceKey || ready.metadata.comic.derivationOperationId !== operationId || ready.metadata.comic.derivationTaskId) throw new Error("保存期间原文或请求已变化，未提交推导");
    }
    catch (error) { guard(); patchSourceTask(projectId, source.id, operationId, { derivationStatus: "failed", derivationOperationId: undefined }); throw error; }
    let task: GenerationTask;
    try { task = await createGenerationTask(input); } catch (error) {
        guard();
        if (definiteRejection(error)) patchSourceTask(projectId, source.id, operationId, { derivationStatus: "failed", derivationOperationId: undefined, derivationError: error.message });
        throw error;
    }
    guard();
    patchSourceTask(projectId, source.id, operationId, { derivationTaskId: task.id, derivationStatus: "running", derivationError: undefined });
    await saveRemoteUserDataNow(projectId);
    return task;
}

export async function submitComicImage(projectId: string, nodeId: string, config: AiConfig) {
    const guard = sessionGuard();
    let project = currentComicProject(projectId);
    let node = project.nodes.find((item) => item.id === nodeId);
    if (!node || !["asset", "panel"].includes(node.metadata?.comic?.role || "")) throw new Error("请选择漫画资产或分镜");
    if (!node.metadata?.taskId && node.metadata?.taskClientOperationId) {
        await recoverComicSubmissions(projectId); guard();
        const recovered = currentComicProject(projectId).nodes.find((item) => item.id === nodeId)!;
        if (recovered.metadata?.taskId) return queryGenerationTask(recovered.metadata.taskId);
        throw new Error(uncertainSubmission);
    }
    const nodeKey = comicNodeTaskKey(node);
    if (node.metadata?.taskId) {
        const previous = await queryGenerationTask(node.metadata.taskId);
        guard();
        await rejectUncertainTask(previous); guard();
        if (previous.status === "succeeded" && node.metadata.status !== "success") throw new Error("原任务已完成，请先恢复原任务结果");
    }
    project = currentComicProject(projectId);
    node = project.nodes.find((item) => item.id === nodeId)!;
    if (!node || comicNodeTaskKey(node) !== nodeKey) throw new Error("节点已被其他操作修改，请重新确认后生成");
    const rawPrompt = nodeGenerationPrompt(node);
    if (!rawPrompt.trim()) throw new Error("请先填写提示词");
    const { references, bindings, styleIndex, styleAdded } = comicSubmissionReferences(node, project);
    const prompt = [normalizeComicImagePromptReferences(comicImagePrompt(node, getComicSource(project.nodes)), references), comicStyleReferenceInstruction(styleIndex, styleAdded)].filter(Boolean).join("\n");
    const selectedConfig = comicImageConfig(node, config, false);
    if (!selectedConfig.model) throw new Error("请选择图片模型");
    assertCanvasImageReferenceLimit(selectedConfig, references);
    const compatibilityError = modelCompatibilityError(selectedConfig, selectedConfig.model, { capability: "image", input: { imageCount: references.length, textCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } });
    if (compatibilityError) throw new Error(compatibilityError);
    const spec = specFromConfig("image", rawPrompt, selectedConfig, bindings, "prompt-only");
    const referenceKey = comicImageInputKey(node, project);
    const operationId = createClientUUID();
    const input = await prepareBackendGenerationTask({ projectId, mode: "image", prompt, config: selectedConfig, referenceImages: references, clientOperationId: operationId, metadata: { nodeId } });
    guard();
    const latest = currentComicProject(projectId);
    const latestNode = latest.nodes.find((item) => item.id === nodeId);
    if (!latestNode || comicImageInputKey(latestNode, latest) !== referenceKey) throw new Error("画风、提示词或参考图已更新，请按最新设置重新生成");
    patchNode(projectId, nodeId, (current) => {
        if (comicNodeTaskKey(current) !== nodeKey) throw new Error("节点已被其他操作修改，请重新确认后生成");
        return { ...current, metadata: {
        ...resetGenerationTaskMetadata(current.metadata, "loading"), ...mediaVersionFieldsBeforeReplace(current), ...generationSpecMetadata(spec),
        prompt: rawPrompt, taskClientOperationId: operationId, references: references.map((reference) => reference.storageKey || reference.url || reference.dataUrl),
    } }; });
    const clearUnsubmitted = () => patchNode(projectId, nodeId, (current) => current.metadata?.taskClientOperationId === operationId && !current.metadata.taskId ? { ...current, metadata: resetGenerationTaskMetadata(current.metadata, "error") } : current);
    const pendingNodeKey = comicNodeTaskKey(currentComicProject(projectId).nodes.find((item) => item.id === nodeId)!);
    try {
        await prepareCanvasForCloudAction(projectId); guard();
        const readyProject = currentComicProject(projectId);
        const readyNode = readyProject.nodes.find((item) => item.id === nodeId);
        if (!readyNode || comicNodeTaskKey(readyNode) !== pendingNodeKey || comicImageInputKey(readyNode, readyProject) !== referenceKey) throw new Error("保存期间提示词、画风、任务或参考图已变化，未提交生成");
    }
    catch (error) { guard(); clearUnsubmitted(); throw error; }
    try {
        const task = await createGenerationTask(input);
        guard();
        patchNode(projectId, nodeId, (current) => {
            if (current.metadata?.taskClientOperationId !== operationId || current.metadata.taskId) throw new Error("节点任务已变化，原任务可在任务中心查看");
            return { ...current, metadata: { ...current.metadata, ...generationTaskMetadata(task), taskClientOperationId: operationId, status: "loading" } };
        });
        await saveRemoteUserDataNow(projectId);
        return task;
    } catch (error) { guard(); if (definiteRejection(error)) clearUnsubmitted(); throw error; }
}

const consumption = new Map<string, Promise<void>>();
export function consumeComicTask(projectId: string, task: GenerationTask, imageConfig: AiConfig): Promise<void> {
    const key = `${getActiveUserScope()}:${projectId}:${task.id}`;
    const previous = consumption.get(key);
    if (previous) return previous;
    const pending = consumeTask(projectId, task, imageConfig).finally(() => consumption.delete(key));
    consumption.set(key, pending);
    return pending;
}

async function consumeTask(projectId: string, task: GenerationTask, imageConfig: AiConfig) {
    const guard = sessionGuard();
    if (task.projectId !== projectId) throw new Error("任务不属于当前作品");
    let project = currentComicProject(projectId);
    const source = getComicSource(project.nodes)!;
    const comic = source.metadata?.comic;
    if (comic?.role === "source" && comic.derivationTaskId === task.id) {
        if (comic.derivationStatus === "succeeded" || comic.derivationStatus === "failed") return;
        if (task.status === "queued" || task.status === "running") return;
        try {
            if (task.status !== "succeeded") throw new Error(task.error || "提示词推导未完成，请查看任务中心");
            if (await sourceFingerprint(source) !== comic.derivationFingerprint) throw new Error("推导期间原文或参数已修改，未覆盖当前内容；请新建作品重新推导");
            guard();
            const sourceKey = comicSourceStateKey(source);
            const plan = parseComicDerivation(parseBackendGenerationResult(task).text || "");
            const result = buildComicNodes(plan, source, imageConfig);
            project = currentComicProject(projectId);
            if (getComicAssets(project.nodes).length || getComicPanels(project.nodes).length) throw new Error("作品已有新内容，未覆盖当前资产和分镜");
            const currentSource = getComicSource(project.nodes)!;
            if (await sourceFingerprint(currentSource) !== comic.derivationFingerprint) throw new Error("原文或参数已修改，未采用过期推导结果");
            guard();
            // Re-read after the hash await so unrelated AI edits remain in the document.
            project = currentComicProject(projectId);
            const finalSource = getComicSource(project.nodes)!;
            if (comicSourceStateKey(finalSource) !== sourceKey || finalSource.metadata.comic.derivationTaskId !== task.id || getComicAssets(project.nodes).length || getComicPanels(project.nodes).length) throw new Error("作品已变化，未覆盖当前内容");
            useCanvasStore.getState().updateProject(projectId, { nodes: [...project.nodes.map((node) => node.id === source.id ? { ...node, metadata: { ...node.metadata, comic: { ...finalSource.metadata.comic, derivationStatus: "succeeded" as const, derivationError: undefined } } } : node), ...result.nodes], connections: [...project.connections, ...result.connections] });
        } catch (error) {
            guard();
            patchSourceTask(projectId, source.id, comic.derivationOperationId!, { derivationStatus: "failed", derivationError: error instanceof Error ? error.message : "推导结果无法读取" });
            await saveRemoteUserDataNow(projectId);
            throw error;
        }
        await saveRemoteUserDataNow(projectId);
        return;
    }
    const node = project.nodes.find((item) => item.metadata?.taskId === task.id && ["asset", "panel"].includes(item.metadata?.comic?.role || ""));
    if (!node) return;
    if (task.status === "succeeded") {
        await syncGenerationTaskToCanvasStore(task);
        guard();
        await saveRemoteUserDataNow(projectId);
    } else {
        patchNode(projectId, node.id, (current) => ({ ...current, metadata: { ...current.metadata, ...generationTaskMetadata(task), status: task.status === "queued" || task.status === "running" ? "loading" : "error", errorDetails: task.error } }));
    }
}

export async function recoverComicSubmissions(projectId: string) {
    const guard = sessionGuard();
    const project = currentComicProject(projectId);
    const source = getComicSource(project.nodes)!;
    const comic = source.metadata?.comic;
    const missing = project.nodes.filter((node) => node.metadata?.taskClientOperationId && !node.metadata.taskId);
    const derivationMissing = comic?.role === "source" && comic.derivationOperationId && !comic.derivationTaskId;
    if (!missing.length && !derivationMissing) return;
    const tasks = await listGenerationTasks(100, { projectId });
    guard();
    for (const node of missing) {
        const task = tasks.find((item) => comicTaskMatches(item, { projectId, nodeId: node.id, operationId: node.metadata!.taskClientOperationId! }));
        if (task) patchNode(projectId, node.id, (current) => current.metadata?.taskClientOperationId === node.metadata?.taskClientOperationId && !current.metadata?.taskId ? ({ ...current, metadata: { ...current.metadata, ...generationTaskMetadata(task), taskClientOperationId: node.metadata?.taskClientOperationId, status: task.status === "failed" || task.status === "cancelled" ? "error" : "loading", errorDetails: task.error } }) : current);
    }
    if (derivationMissing && comic?.role === "source") {
        const task = tasks.find((item) => comicTaskMatches(item, { projectId, sourceNodeId: source.id, operationId: comic.derivationOperationId! }));
        if (task) patchSourceTask(projectId, source.id, comic.derivationOperationId!, { derivationTaskId: task.id, derivationStatus: "running" });
    }
}

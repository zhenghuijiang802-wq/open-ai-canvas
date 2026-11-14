import type { GenerationTask } from "@/services/api/task-center";
import type { CanvasNodeData } from "@/types/canvas";
import { canonicalize } from "json-canonicalize";
import { nodeGenerationPrompt, readNodeGenerationSpec } from "./generation-contract";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function taskMetadata(task: GenerationTask): JsonObject | undefined {
    if (typeof task.inputJson !== "string" || !task.inputJson.trim()) return undefined;
    try {
        return object(object(JSON.parse(task.inputJson))?.metadata);
    } catch {
        return undefined;
    }
}

function operationId(value: unknown): string {
    return typeof value === "string" && value.length <= 128 && value.trim().length > 0 ? value : "";
}

/** Compare this synchronously immediately before a write; hashing alone leaves an await race. */
export function comicSourceStateKey(source: CanvasNodeData): string {
    return canonicalize([
        source.id,
        source.metadata?.content ?? "",
        source.metadata?.comic?.role === "source" ? source.metadata.comic.settings : null,
    ]);
}

/** Ordinary task responses currently retain the operation identity in inputJson metadata. */
export function comicTaskOperationId(task: GenerationTask): string {
    return operationId(task.clientOperationId) || operationId(task.clientContext?.clientOperationId) || operationId(taskMetadata(task)?.clientOperationId);
}

export type ComicTaskIdentity = {
    projectId: string;
    operationId: string;
    nodeId?: string;
    sourceNodeId?: string;
};

/** A matching operation string alone is insufficient to attach a task to a canvas node. */
export function comicTaskMatches(task: GenerationTask, expected: ComicTaskIdentity): boolean {
    if (!expected.projectId || !operationId(expected.operationId) || task.projectId !== expected.projectId) return false;
    if (Boolean(expected.nodeId) === Boolean(expected.sourceNodeId)) return false;
    if ((expected.nodeId || expected.sourceNodeId || "").length > 80) return false;
    const metadata = taskMetadata(task);
    const context = task.clientContext;
    if (comicTaskOperationId(task) !== expected.operationId) return false;
    for (const value of [task.clientOperationId, context?.clientOperationId, metadata?.clientOperationId]) {
        if (value !== undefined && value !== "" && operationId(value) !== expected.operationId) return false;
    }
    if (expected.nodeId) {
        return task.type === "canvas_image"
            && (!task.operation || task.operation === "image")
            && (context?.nodeId || metadata?.nodeId) === expected.nodeId
            && (!context?.nodeId || context.nodeId === expected.nodeId)
            && (metadata?.nodeId === undefined || metadata.nodeId === expected.nodeId)
            && !context?.comicSourceNodeId
            && metadata?.comicSourceNodeId === undefined;
    }
    return task.type === "canvas_text"
        && (!task.operation || task.operation === "text")
        && (context?.comicSourceNodeId || metadata?.comicSourceNodeId) === expected.sourceNodeId
        && (!context?.comicSourceNodeId || context.comicSourceNodeId === expected.sourceNodeId)
        && (metadata?.comicSourceNodeId === undefined || metadata.comicSourceNodeId === expected.sourceNodeId)
        && metadata?.nodeId === undefined
        && !context?.nodeId;
}

/** Polling progress does not invalidate submission ownership; edited creative intent does. */
export function comicNodeTaskKey(node: CanvasNodeData): string {
    const spec = readNodeGenerationSpec(node);
    return canonicalize([
        node.id,
        node.type,
        node.metadata?.taskId ?? null,
        node.metadata?.taskClientOperationId ?? null,
        nodeGenerationPrompt(node),
        spec?.referenceBindings ?? [],
        spec?.modelSelection ?? null,
        spec?.options ?? {},
        node.metadata?.comic?.role === "asset" || node.metadata?.comic?.role === "panel" ? [node.metadata.comic.useUnifiedStyle ?? true, node.metadata.comic.promptStylePrefix ?? null] : null,
    ]);
}

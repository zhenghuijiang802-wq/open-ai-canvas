import { describe, expect, test } from "bun:test";
import { comicNodeTaskKey, comicSourceStateKey, comicTaskMatches, comicTaskOperationId } from "../src/lib/canvas/comic-task-state";
import { buildComicNodes, createComicSourceNode, DEFAULT_COMIC_SETTINGS } from "../src/lib/canvas/comic-workflow";
import { writeCanvasNodePrompt } from "../src/lib/canvas/canvas-node-prompt";
import { defaultConfig } from "../src/stores/use-config-store";
import type { GenerationTask } from "../src/services/api/task-center";

function task(metadata: Record<string, unknown>, patch: Partial<GenerationTask> = {}): GenerationTask {
    return { id: "task-1", projectId: "project-1", type: "canvas_image", operation: "image", status: "queued", prompt: "图片", attempts: 0, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z", inputJson: JSON.stringify({ metadata }), ...patch };
}

describe("comic task identity", () => {
    test("recovers ordinary backend operation IDs stored only in input metadata", () => {
        const original = task({ clientOperationId: "operation-1", nodeId: "asset-1" });
        expect(comicTaskOperationId(original)).toBe("operation-1");
        expect(comicTaskMatches(original, { projectId: "project-1", operationId: "operation-1", nodeId: "asset-1" })).toBe(true);
        expect(comicTaskOperationId({ ...original, clientOperationId: "top-level" })).toBe("top-level");
        expect(comicTaskMatches({ ...original, clientOperationId: "top-level" }, { projectId: "project-1", operationId: "top-level", nodeId: "asset-1" })).toBe(false);
    });

    test("requires the source metadata field and text task type for derivations", () => {
        const original = task({ clientOperationId: "operation-1", comicSourceNodeId: "source-1" }, { type: "canvas_text", operation: "text" });
        const expected = { projectId: "project-1", operationId: "operation-1", sourceNodeId: "source-1" };
        expect(comicTaskMatches(original, expected)).toBe(true);
        for (const patch of [{ projectId: "other" }, { type: "canvas_image" }, { operation: "storyboard" }, { clientContext: { nodeId: "other" } }]) {
            expect(comicTaskMatches({ ...original, ...patch }, expected)).toBe(false);
        }
        expect(comicTaskMatches(task({ clientOperationId: "operation-1", nodeId: "source-1" }, { type: "canvas_text", operation: "text" }), expected)).toBe(false);
    });

    test("recovers redacted list responses through the backend client context projection", () => {
        const image = task({}, { inputJson: undefined, clientContext: { clientOperationId: "operation-1", nodeId: "asset-1" } });
        expect(comicTaskOperationId(image)).toBe("operation-1");
        expect(comicTaskMatches(image, { projectId: "project-1", operationId: "operation-1", nodeId: "asset-1" })).toBe(true);
        const text = task({}, { type: "canvas_text", operation: "text", inputJson: undefined, clientContext: { clientOperationId: "operation-1", comicSourceNodeId: "source-1" } });
        expect(comicTaskMatches(text, { projectId: "project-1", operationId: "operation-1", sourceNodeId: "source-1" })).toBe(true);
        expect(comicTaskMatches({ ...text, inputJson: JSON.stringify({ metadata: { comicSourceNodeId: "other" } }) }, { projectId: "project-1", operationId: "operation-1", sourceNodeId: "source-1" })).toBe(false);
        expect(comicTaskMatches({ ...image, clientOperationId: "different" }, { projectId: "project-1", operationId: "different", nodeId: "asset-1" })).toBe(false);
    });

    test("never adopts another project, target or operation and rejects ambiguous targets", () => {
        const original = task({ clientOperationId: "operation-1", nodeId: "asset-1" });
        const expected = { projectId: "project-1", operationId: "operation-1", nodeId: "asset-1" };
        for (const patch of [{ projectId: "other" }, { operationId: "other" }, { nodeId: "other" }, { nodeId: undefined }, { sourceNodeId: "asset-1" }, { operationId: "" }]) {
            expect(comicTaskMatches(original, { ...expected, ...patch })).toBe(false);
        }
        expect(comicTaskMatches({ ...original, clientContext: { nodeId: "other" } }, expected)).toBe(false);
        expect(comicTaskMatches(task({ clientOperationId: "operation-1", nodeId: "asset-1", comicSourceNodeId: "source-1" }), expected)).toBe(false);
    });

    test("malformed or misleading JSON is inert and never resolves a target", () => {
        const expected = { projectId: "project-1", operationId: "operation-1", nodeId: "asset-1" };
        for (const inputJson of [undefined, "", "not JSON", "null", "[]", '{"metadata":[]}', '{"metadata":{"clientOperationId":{}}}', '{"metadata":{"__proto__":{"clientOperationId":"operation-1","nodeId":"asset-1"}}}', '(()=>({metadata:{clientOperationId:"operation-1",nodeId:"asset-1"}}))()']) {
            const original = task({}, { inputJson });
            expect(comicTaskOperationId(original)).toBe("");
            expect(comicTaskMatches(original, expected)).toBe(false);
        }
        expect(comicTaskMatches(task({ nodeId: "asset-1" }, { clientOperationId: "operation-1" }), expected)).toBe(true);
    });

    test("uses the shared 128-character operation and 80-character node identity bounds", () => {
        const op = "o".repeat(128), nodeId = "n".repeat(80);
        const original = task({ clientOperationId: op, nodeId });
        expect(comicTaskMatches(original, { projectId: "project-1", operationId: op, nodeId })).toBe(true);
        expect(comicTaskOperationId(task({ clientOperationId: `${op}x`, nodeId }))).toBe("");
        expect(comicTaskMatches(task({ clientOperationId: op, nodeId: `${nodeId}x` }), { projectId: "project-1", operationId: op, nodeId: `${nodeId}x` })).toBe(false);
    });
});

describe("comic asynchronous write guards", () => {
    test("source content, settings or identity changes invalidate a captured source key", () => {
        const source = createComicSourceNode("原文", DEFAULT_COMIC_SETTINGS), key = comicSourceStateKey(source);
        expect(comicSourceStateKey(structuredClone(source))).toBe(key);
        expect(comicSourceStateKey({ ...source, metadata: { ...source.metadata, comic: { ...source.metadata.comic, settings: { narrativePreset: DEFAULT_COMIC_SETTINGS.narrativePreset, emotionTone: DEFAULT_COMIC_SETTINGS.emotionTone, storyType: DEFAULT_COMIC_SETTINGS.storyType, panelCount: DEFAULT_COMIC_SETTINGS.panelCount, aspectRatio: DEFAULT_COMIC_SETTINGS.aspectRatio, style: DEFAULT_COMIC_SETTINGS.style } } } })).toBe(key);
        expect(comicSourceStateKey({ ...source, title: "只改标题", metadata: { ...source.metadata, comic: { ...source.metadata.comic, derivationStatus: "running" } } })).toBe(key);
        for (const changed of [
            { ...source, id: "replacement-source" },
            { ...source, metadata: { ...source.metadata, content: "新原文" } },
            { ...source, metadata: { ...source.metadata, comic: { ...source.metadata.comic, settings: { ...source.metadata.comic.settings, style: "新画风" } } } },
        ]) expect(comicSourceStateKey(changed)).not.toBe(key);
    });

    test("node task replacement, prompt edits and reference edits invalidate ownership but polling does not", () => {
        const source = createComicSourceNode("原文", { ...DEFAULT_COMIC_SETTINGS, panelCount: 1 });
        const built = buildComicNodes({ assets: [{ id: "a", kind: "character", name: "角色", prompt: "角色设定" }], panels: [{ id: "p", title: "分镜", prompt: "角色近景", assetIds: ["a"], sourceExcerpt: "原文" }] }, source, defaultConfig);
        const node = built.nodes[1];
        node.metadata.taskId = "task-1"; node.metadata.taskClientOperationId = "operation-1";
        const key = comicNodeTaskKey(node);
        expect(comicNodeTaskKey({ ...node, metadata: { ...node.metadata, taskProgress: 80, taskStatus: "running", status: "loading" } })).toBe(key);
        expect(comicNodeTaskKey({ ...node, metadata: { ...node.metadata, taskId: "task-2" } })).not.toBe(key);
        expect(comicNodeTaskKey({ ...node, metadata: { ...node.metadata, taskClientOperationId: "operation-2" } })).not.toBe(key);
        expect(comicNodeTaskKey(writeCanvasNodePrompt(node, "用户最新提示词"))).not.toBe(key);
        const spec = node.metadata.generationSpec!;
        expect(comicNodeTaskKey({ ...node, metadata: { ...node.metadata, generationSpec: { ...spec, options: Object.fromEntries(Object.entries(spec.options).reverse()) } } })).toBe(key);
        expect(comicNodeTaskKey({ ...node, metadata: { ...node.metadata, generationSpec: { ...spec, referenceBindings: [] } } })).not.toBe(key);
        expect(comicNodeTaskKey({ ...node, metadata: { ...node.metadata, generationSpec: { ...spec, options: { ...spec.options, size: "1:1" } } } })).not.toBe(key);
    });
});

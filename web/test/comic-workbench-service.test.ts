// Run this file alone: bun test test/comic-workbench-service.test.ts
// mock.module is intentionally process-local; never combine this suite with other tests.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "../src/types/canvas";
import type { BackendGenerationTaskOptions } from "../src/services/api/generation-task";
import type { CreateTaskInput, GenerationTask } from "../src/services/api/task-center";
import type { AiConfig } from "../src/stores/use-config-store";

let projects: CanvasProject[] = [];
const state = {
    get projects() { return projects; },
    updateProject(id: string, patch: Partial<CanvasProject>) {
        projects = projects.map((project) => project.id === id ? { ...project, ...patch } : project);
    },
};
mock.module("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore: { getState: () => state } }));

let prepareHook: (input: BackendGenerationTaskOptions) => Promise<void> = async () => {};
let cloudHook: () => Promise<void> = async () => {};
let saveHook: (id: string) => Promise<void> = async () => {};
let postHook: ((input: CreateTaskInput) => Promise<GenerationTask>) | undefined;
let queryHook: ((id: string) => Promise<GenerationTask>) | undefined;
let listed: GenerationTask[] = [];
let prepared: BackendGenerationTaskOptions[] = [];
let posted: CreateTaskInput[] = [];
let queried: string[] = [];
let saves: string[] = [];
let listCalls = 0;
const tasks = new Map<string, GenerationTask>();

mock.module("@/services/user-data-sync", () => ({
    prepareCanvasForCloudAction: async () => cloudHook(),
    saveRemoteUserDataNow: async (id: string) => { saves.push(id); await saveHook(id); },
}));
mock.module("@/lib/canvas/canvas-generation-task-sync", () => ({
    syncGenerationTaskToCanvasStore: async () => { throw new Error("Unexpected media materialization in submission tests"); },
    imageMetadata: () => { throw new Error("Unexpected image upload in submission tests"); },
}));

// Keep real result parsing, canonical contracts, reference resolution, and model validation.
const nativeTaskApi = { ...await import("../src/services/api/task-center") };
const nativeGenerationApi = { ...await import("../src/services/api/generation-task") };
mock.module("@/services/api/task-center", () => ({
    ...nativeTaskApi,
    createGenerationTask: async (input: CreateTaskInput) => {
        posted.push(structuredClone(input));
        if (postHook) return postHook(input);
        const metadata = (input.input?.metadata || {}) as Record<string, string>;
        const result = makeTask({ id: `task-${posted.length}`, projectId: input.projectId, type: input.type, operation: input.operation, prompt: input.prompt, inputJson: JSON.stringify(input.input), clientContext: { clientOperationId: metadata.clientOperationId, nodeId: metadata.nodeId, comicSourceNodeId: metadata.comicSourceNodeId } });
        tasks.set(result.id, result);
        return result;
    },
    queryGenerationTask: async (id: string) => {
        queried.push(id);
        if (queryHook) return queryHook(id);
        const task = tasks.get(id);
        if (!task) throw new Error(`Missing mock task: ${id}`);
        return task;
    },
    listGenerationTasks: async () => { listCalls++; return listed; },
}));
mock.module("@/services/api/generation-task", () => ({
    ...nativeGenerationApi,
    prepareBackendGenerationTask: async (input: BackendGenerationTaskOptions): Promise<CreateTaskInput> => {
        prepared.push(structuredClone(input));
        await prepareHook(input);
        return { projectId: input.projectId, type: `canvas_${input.mode}`, operation: input.mode, prompt: input.prompt, model: input.config.model,
            input: { mode: input.mode, prompt: input.prompt, referenceImages: input.referenceImages || [], metadata: { ...input.metadata, clientOperationId: input.clientOperationId } } };
    },
}));

const { ApiError } = await import("../src/services/api/request");
const { defaultConfig, encodeChannelModel } = await import("../src/stores/use-config-store");
const { CanvasNodeType } = await import("../src/types/canvas");
const { buildComicNodes, createComicSourceNode, DEFAULT_COMIC_SETTINGS, getComicAssets, getComicPanels, getComicSource } = await import("../src/lib/canvas/comic-workflow");
const { generationSpecMetadata, nodeGenerationPrompt, readNodeGenerationSpec } = await import("../src/lib/canvas/generation-contract");
const { writeCanvasNodePrompt } = await import("../src/lib/canvas/canvas-node-prompt");
const { comicImagePrompt, updateComicImageConfig } = await import("../src/lib/canvas/comic-image-editing");
const { defaultImageCapabilityConfig } = await import("../src/lib/model-capabilities");
const service = await import("../src/services/comic-workbench");

const sourceText = "小林来到屋顶。小林举起红伞。";
const config: AiConfig = { ...defaultConfig, model: encodeChannelModel("test-channel", "gpt-image-1"), imageModel: encodeChannelModel("test-channel", "gpt-image-1"), size: "9:16", count: "1", channels: [{ id: "test-channel", name: "测试", apiKey: "", baseUrl: "/test", apiFormat: "openai", enabled: true, models: ["gpt-image-1"], modelCosts: [{ model: "gpt-image-1", capability: "image", protocol: "openai-image", billingMode: "fixed_request", unitPriceMicrocredits: 1 }] }] };
const plan = {
    assets: [
        { id: "hero", name: "小林", kind: "character" as const, prompt: "黑发青年，蓝色外套，角色设定参考。" },
        { id: "umbrella", name: "红伞", kind: "prop" as const, prompt: "红色雨伞，单一道具参考。" },
    ],
    panels: [{ id: "raise", title: "举伞", prompt: "中景，小林举起红伞，衣服湿润。", assetIds: ["hero"], sourceExcerpt: "小林举起红伞。" }],
};

function makeTask(patch: Partial<GenerationTask> = {}): GenerationTask {
    return { id: "task", projectId: "comic-project", type: "canvas_image", operation: "image", status: "queued", prompt: "画面", attempts: 0, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z", ...patch };
}

function reset() {
    projects = []; tasks.clear(); listed = []; prepared = []; posted = []; queried = []; saves = []; listCalls = 0;
    prepareHook = async () => {}; cloudHook = async () => {}; saveHook = async () => {}; postHook = undefined; queryHook = undefined;
}
beforeEach(reset);

function setup(withImages = false) {
    const source = createComicSourceNode(sourceText, { ...DEFAULT_COMIC_SETTINGS, panelCount: 1 });
    const result = withImages ? buildComicNodes(plan, source, config) : { nodes: [], connections: [] };
    const project: CanvasProject = { id: "comic-project", title: "漫画测试", createdAt: "", updatedAt: "", nodes: [source, ...result.nodes], connections: result.connections, chatSessions: [], activeChatId: null, backgroundMode: "dots", showImageInfo: true, viewport: { x: 0, y: 0, k: 1 }, previsScenes: [] };
    projects = [project];
    return { source, project, assets: getComicAssets(project.nodes), panels: getComicPanels(project.nodes) };
}
function current() { return projects[0]; }
function node(id: string) { return current().nodes.find((item) => item.id === id)!; }
function editNode(id: string, change: (node: CanvasNodeData) => CanvasNodeData) {
    state.updateProject(current().id, { nodes: current().nodes.map((item) => item.id === id ? change(item) : item) });
}
function sourceComic() { return getComicSource(current().nodes)!.metadata.comic; }
function ready(id: string) {
    editNode(id, (item) => ({ ...item, metadata: { ...item.metadata, status: "success", storageKey: `resource:${id}`, content: `https://test.invalid/${id}.png` } }));
}
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}
function holdPrepare(phase: "input" | "cloud") {
    const entered = deferred(), release = deferred();
    const hook = async () => { entered.resolve(); await release.promise; };
    if (phase === "input") prepareHook = hook; else cloudHook = hook;
    return { entered: entered.promise, release: release.resolve };
}

describe("comic submission receipts and recovery", () => {
    test("lost derivation response keeps the operation and never issues a second POST", async () => {
        const { project } = setup();
        postHook = async () => { throw new TypeError("network response lost"); };
        await expect(service.submitComicDerivation(project.id, config)).rejects.toThrow("network response lost");
        const operationId = sourceComic().derivationOperationId;
        expect(operationId).toBeTruthy(); expect(sourceComic().derivationStatus).toBe("pending");
        await expect(service.submitComicDerivation(project.id, config)).rejects.toThrow("暂不重复提交");
        expect(posted).toHaveLength(1); expect(listCalls).toBe(1);
        expect(sourceComic().derivationOperationId).toBe(operationId);
    });

    test("lost image response remains recoverable and retries query without another POST", async () => {
        const { project, assets } = setup(true);
        postHook = async () => { throw new TypeError("network response lost"); };
        await expect(service.submitComicImage(project.id, assets[0].id, config)).rejects.toThrow("network response lost");
        const operationId = node(assets[0].id).metadata?.taskClientOperationId;
        expect(operationId).toBeTruthy(); expect(node(assets[0].id).metadata?.taskId).toBeUndefined();
        await expect(service.submitComicImage(project.id, assets[0].id, config)).rejects.toThrow("暂不重复提交");
        expect(posted).toHaveLength(1); expect(listCalls).toBe(1);
        expect(node(assets[0].id).metadata?.taskClientOperationId).toBe(operationId);
    });

    test("redacted list clientContext binds only matching project, operation and target", async () => {
        const { project, source, assets } = setup(true);
        editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...source.metadata.comic, derivationOperationId: "derive-op", derivationStatus: "pending" } } }));
        editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, taskClientOperationId: "image-op", status: "loading" } }));
        listed = [
            makeTask({ id: "wrong-project", projectId: "other", clientContext: { clientOperationId: "image-op", nodeId: assets[0].id } }),
            makeTask({ id: "wrong-target", clientContext: { clientOperationId: "image-op", nodeId: assets[1].id } }),
            makeTask({ id: "right-image", clientContext: { clientOperationId: "image-op", nodeId: assets[0].id } }),
            makeTask({ id: "right-derive", type: "canvas_text", operation: "text", clientContext: { clientOperationId: "derive-op", comicSourceNodeId: source.id } }),
        ];
        await service.recoverComicSubmissions(project.id);
        expect(node(assets[0].id).metadata?.taskId).toBe("right-image");
        expect(node(assets[0].id).metadata?.taskClientOperationId).toBe("image-op");
        expect(sourceComic().derivationTaskId).toBe("right-derive"); expect(sourceComic().derivationStatus).toBe("running");
        expect(posted).toHaveLength(0);
    });

    test("an existing failed but recoverable task blocks a replacement charge", async () => {
        const { project, assets } = setup(true);
        editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, taskId: "old-task", status: "error" } }));
        tasks.set("old-task", makeTask({ id: "old-task", status: "failed", canRecoverMedia: true }));
        await expect(service.submitComicImage(project.id, assets[0].id, config)).rejects.toThrow("仍可恢复");
        expect(posted).toHaveLength(0); expect(node(assets[0].id).metadata?.taskId).toBe("old-task");
    });

    test("failed detail without billing still blocks retry when its summary settlement is uncertain", async () => {
        for (const kind of ["source", "image"] as const) {
            reset(); const { project, source, assets } = setup(kind === "image");
            const previous = makeTask({ id: "old-task", status: "failed", type: kind === "source" ? "canvas_text" : "canvas_image", operation: kind === "source" ? "text" : "image" });
            tasks.set(previous.id, previous);
            listed = [{ ...previous, billing: { amountMicrocredits: 1000, status: "uncertain" } }];
            if (kind === "source") editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...source.metadata.comic, derivationTaskId: previous.id, derivationOperationId: "old-op", derivationStatus: "failed" } } }));
            else editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, taskId: previous.id, status: "error" } }));
            await expect(kind === "source" ? service.submitComicDerivation(project.id, config) : service.submitComicImage(project.id, assets[0].id, config)).rejects.toThrow("结算待确认");
            expect(queried).toEqual([previous.id]); expect(listCalls).toBe(1);
            expect(prepared).toHaveLength(0); expect(posted).toHaveLength(0);
            expect(kind === "source" ? sourceComic().derivationTaskId : node(assets[0].id).metadata?.taskId).toBe(previous.id);
        }
    });
});

describe("comic source and image workflow", () => {
    test("a real derivation materializes canonical image nodes and source/reference edges without replacing prose", async () => {
        const { project, source } = setup();
        const submitted = await service.submitComicDerivation(project.id, config);
        expect(prepared[0].prompt).toContain(JSON.stringify(sourceText));
        const untouched: CanvasNodeData = { ...source, id: "ordinary-ai-note", title: "AI 旁注", metadata: { content: "已有备注" } };
        state.updateProject(project.id, { nodes: [...current().nodes, untouched] });
        await service.consumeComicTask(project.id, { ...submitted, status: "succeeded", resultJson: JSON.stringify({ text: JSON.stringify(plan) }) }, config);
        const assets = getComicAssets(current().nodes), panels = getComicPanels(current().nodes);
        expect(assets).toHaveLength(2); expect(panels).toHaveLength(1);
        expect(getComicSource(current().nodes)!.metadata.content).toBe(sourceText);
        expect(node(untouched.id)).toEqual(untouched); expect(sourceComic().derivationStatus).toBe("succeeded");
        expect(current().connections.some((edge) => edge.fromNodeId === source.id && edge.toNodeId === assets[0].id)).toBe(true);
        expect(current().connections.some((edge) => edge.fromNodeId === assets[0].id && edge.toNodeId === panels[0].id)).toBe(true);
        expect(readNodeGenerationSpec(panels[0])?.prompt).toContain(plan.panels[0].prompt);
        expect(readNodeGenerationSpec(panels[0])?.referenceBindings[0].nodeId).toBe(assets[0].id);
        expect(nodeGenerationPrompt(panels[0])).toBe(readNodeGenerationSpec(panels[0])?.prompt);
        expect(saves.length).toBeGreaterThan(0);
    });

    test("image generation follows current connections, replaces stale canonical refs and preserves edited prompt", async () => {
        const { project, assets, panels, source } = setup(true);
        ready(assets[0].id); ready(assets[1].id);
        editNode(panels[0].id, (item) => writeCanvasNodePrompt(item, "AI 已细化的最新画面描述"));
        state.updateProject(project.id, { connections: [
            ...current().connections.filter((edge) => edge.toNodeId !== panels[0].id),
            { id: "source-panel", fromNodeId: source.id, toNodeId: panels[0].id },
            { id: "changed-ref", fromNodeId: assets[1].id, toNodeId: panels[0].id },
        ] });
        await service.submitComicImage(project.id, panels[0].id, config);
        expect(prepared[0].referenceImages?.map((reference) => reference.id)).toEqual([assets[1].id]);
        expect(prepared[0].prompt).toBe(`画风：${DEFAULT_COMIC_SETTINGS.style}\nAI 已细化的最新画面描述`);
        expect(nodeGenerationPrompt(node(panels[0].id))).toBe("AI 已细化的最新画面描述");
        expect(readNodeGenerationSpec(node(panels[0].id))?.referenceBindings.map((binding) => binding.nodeId)).toEqual([assets[1].id]);
        expect(posted).toHaveLength(1);
    });

    test("missing media, a deleted connected asset or a loading reference never reaches POST", async () => {
        for (const kind of ["empty", "deleted", "loading"] as const) {
            reset(); const { project, assets, panels } = setup(true);
            if (kind === "deleted") state.updateProject(project.id, { nodes: current().nodes.filter((item) => item.id !== assets[0].id) });
            if (kind === "loading") { ready(assets[0].id); editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, status: "loading" } })); }
            await expect(service.submitComicImage(project.id, panels[0].id, config)).rejects.toThrow();
            expect(posted).toHaveLength(0); expect(prepared).toHaveLength(0);
        }
    });
});

describe("comic delayed operations preserve concurrent edits", () => {
    for (const phase of ["input", "cloud"] as const) {
        test(`source edited during ${phase} preparation is preserved without posting stale text`, async () => {
            const { project, source } = setup(); const gate = holdPrepare(phase);
            const outcome = service.submitComicDerivation(project.id, config).then(() => undefined, (error) => error);
            await gate.entered;
            editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, content: "AI 刚更新了原文。", comic: { ...getComicSource(current().nodes)!.metadata.comic, settings: { ...DEFAULT_COMIC_SETTINGS, style: "AI 新画风", panelCount: 1 } } } }));
            gate.release();
            expect(await outcome).toBeInstanceOf(Error);
            expect(posted).toHaveLength(0); expect(node(source.id).metadata?.content).toBe("AI 刚更新了原文。");
            expect(sourceComic().settings.style).toBe("AI 新画风");
        });

        test(`AI prompt or task replacement during ${phase} preparation is never overwritten or re-submitted`, async () => {
            for (const change of ["prompt", "task"] as const) {
                reset(); const { project, assets } = setup(true); const gate = holdPrepare(phase);
                const outcome = service.submitComicImage(project.id, assets[0].id, config).then(() => undefined, (error) => error);
                await gate.entered;
                editNode(assets[0].id, (item) => change === "prompt" ? writeCanvasNodePrompt(item, "AI 最新提示词") : { ...item, metadata: { ...item.metadata, taskId: "ai-task", taskClientOperationId: "ai-op", status: "loading" } });
                gate.release();
                expect(await outcome).toBeInstanceOf(Error); expect(posted).toHaveLength(0);
                if (change === "prompt") expect(nodeGenerationPrompt(node(assets[0].id))).toBe("AI 最新提示词");
                else { expect(node(assets[0].id).metadata?.taskId).toBe("ai-task"); expect(node(assets[0].id).metadata?.taskClientOperationId).toBe("ai-op"); }
            }
        });
    }

    for (const phase of ["input", "cloud"] as const) {
        test(`reference replacement during ${phase} preparation prevents submission with old media`, async () => {
            const { project, assets, panels } = setup(true); ready(assets[0].id);
            const gate = holdPrepare(phase);
            const outcome = service.submitComicImage(project.id, panels[0].id, config).then(() => undefined, (error) => error);
            await gate.entered;
            editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, storageKey: "resource:new-reference" } }));
            gate.release();
            expect(await outcome).toBeInstanceOf(Error); expect(posted).toHaveLength(0);
            expect(node(assets[0].id).metadata?.storageKey).toBe("resource:new-reference");
        });
    }
});

describe("comic definite rejection versus unknown transport", () => {
    test("a save conflict after successful source POST retains the running task and can materialize it later", async () => {
        const { project } = setup();
        saveHook = async () => { throw new ApiError("canvas save conflict", { status: 409 }); };
        await expect(service.submitComicDerivation(project.id, config)).rejects.toThrow("canvas save conflict");
        const taskId = sourceComic().derivationTaskId;
        const operationId = sourceComic().derivationOperationId;
        expect(taskId).toBe("task-1"); expect(operationId).toBeTruthy();
        expect(sourceComic().derivationStatus).toBe("running"); expect(posted).toHaveLength(1);
        saveHook = async () => {};
        await expect(service.submitComicDerivation(project.id, config)).rejects.toThrow("原任务正在进行");
        expect(posted).toHaveLength(1); expect(sourceComic().derivationOperationId).toBe(operationId);
        await service.consumeComicTask(project.id, { ...tasks.get(taskId!)!, status: "succeeded", resultJson: JSON.stringify({ text: JSON.stringify(plan) }) }, config);
        expect(sourceComic().derivationStatus).toBe("succeeded"); expect(getComicPanels(current().nodes)).toHaveLength(1);
    });

    test("HTTP 400 clears only its unsubmitted source operation and permits a corrected request", async () => {
        const { project } = setup();
        postHook = async () => { throw new ApiError("invalid model", { status: 400 }); };
        await expect(service.submitComicDerivation(project.id, config)).rejects.toThrow("invalid model");
        expect(sourceComic().derivationStatus).toBe("failed"); expect(sourceComic().derivationOperationId).toBeUndefined();
        postHook = undefined;
        await service.submitComicDerivation(project.id, config);
        expect(posted).toHaveLength(2); expect(sourceComic().derivationTaskId).toBeTruthy();
    });

    test("HTTP 400 clears only its image operation; unknown 503 retains the receipt for lookup", async () => {
        const { project, assets } = setup(true);
        postHook = async () => { throw new ApiError("invalid model", { status: 400 }); };
        await expect(service.submitComicImage(project.id, assets[0].id, config)).rejects.toThrow("invalid model");
        expect(node(assets[0].id).metadata?.taskClientOperationId).toBeUndefined(); expect(node(assets[0].id).metadata?.status).toBe("error");
        postHook = async () => { throw new ApiError("gateway lost response", { status: 503 }); };
        await expect(service.submitComicImage(project.id, assets[0].id, config)).rejects.toThrow("gateway lost response");
        expect(node(assets[0].id).metadata?.taskClientOperationId).toBeTruthy();
        await expect(service.submitComicImage(project.id, assets[0].id, config)).rejects.toThrow("暂不重复提交");
        expect(posted).toHaveLength(2);
    });
});

describe("comic native image editing", () => {
    test("per-item style reference uses the selected preset image or stays empty when removed", async () => {
        const { project, source, assets } = setup(true);
        editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...source.metadata.comic, settings: { ...source.metadata.comic.settings, styleSelection: { id: "original", title: "原画风", referenceResourceId: "original" } } } } }));
        editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...assets[0].metadata.comic, styleReference: { id: "preset", title: "预设", coverUrl: "/comic-style-previews/preset.webp" } } } }));
        editNode(assets[1].id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...assets[1].metadata.comic, styleReference: null } } }));
        await service.submitComicImage(project.id, assets[0].id, config);
        expect(prepared[0].referenceImages?.[0].url).toBe("/comic-style-previews/preset.webp");
        expect(prepared[0].prompt).toContain("@图片1 只参考");
        await service.submitComicImage(project.id, assets[1].id, config);
        expect(prepared[1].referenceImages).toEqual([]);
    });

    test("uploaded style images are appended only while unified style is on without becoming node bindings", async () => {
        const { project, source, assets } = setup(true);
        editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...source.metadata.comic, settings: { ...source.metadata.comic.settings, styleSelection: { id: "style", title: "水彩", referenceResourceId: "watercolor", coverUrl: "/api/resources/watercolor/file" } } } } }));
        await service.submitComicImage(project.id, assets[0].id, config);
        expect(prepared[0].referenceImages?.map((reference) => reference.storageKey)).toEqual(["resource:watercolor"]);
        expect(prepared[0].prompt).toContain("@图片1 只参考");
        expect(readNodeGenerationSpec(node(assets[0].id))!.referenceBindings).toEqual([]);
        expect(nodeGenerationPrompt(node(assets[0].id))).not.toContain("画风参考说明");
        editNode(assets[1].id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...assets[1].metadata.comic, useUnifiedStyle: false } } }));
        await service.submitComicImage(project.id, assets[1].id, config);
        expect(prepared[1].referenceImages).toEqual([]); expect(prepared[1].prompt).not.toContain("画风参考说明");
    });

    test("style image contributes to model reference limits and duplicates do not consume a second slot", async () => {
        const { project, source, assets, panels } = setup(true); ready(assets[0].id);
        const profile = defaultImageCapabilityConfig("openai-image", "gpt-image-1");
        const limited: AiConfig = { ...config, channels: config.channels.map((channel) => ({ ...channel, modelCosts: channel.modelCosts?.map((cost) => ({ ...cost, capabilityConfig: { version: 1, image: { ...profile, references: { ...profile.references, maxImages: 1 } } } })) })) };
        editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...source.metadata.comic, settings: { ...source.metadata.comic.settings, styleSelection: { id: "style", title: "水彩", referenceResourceId: "separate-style" } } } } }));
        await expect(service.submitComicImage(project.id, panels[0].id, limited)).rejects.toThrow("最多支持 1 张");
        expect(posted).toHaveLength(0);
        editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, storageKey: "resource:separate-style" } }));
        await service.submitComicImage(project.id, panels[0].id, limited);
        expect(prepared[0].referenceImages).toHaveLength(1); expect(prepared[0].prompt).toContain("同时提供");
    });

    for (const phase of ["input", "cloud"] as const) {
        test(`style image replacement during ${phase} prevents stale paid generation`, async () => {
            const { project, source, assets } = setup(true);
            editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...source.metadata.comic, settings: { ...source.metadata.comic.settings, styleSelection: { id: "style", title: "水彩", referenceResourceId: "old-style" } } } } }));
            const gate = holdPrepare(phase);
            const outcome = service.submitComicImage(project.id, assets[0].id, config).then(() => undefined, (error) => error);
            await gate.entered;
            editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...getComicSource(current().nodes)!.metadata.comic, settings: { ...getComicSource(current().nodes)!.metadata.comic.settings, styleSelection: { id: "style", title: "水彩", referenceResourceId: "new-style" } } } } }));
            gate.release();
            expect(await outcome).toBeInstanceOf(Error); expect(posted).toHaveLength(0);
        });
    }

    test("submission uses saved node options and leaves raw editable prompt intact when unified style is off", async () => {
        const { project, assets } = setup(true);
        editNode(assets[0].id, (item) => {
            const edited = updateComicImageConfig(item, { ...config, size: "1024x1024", quality: "low", imageParameters: '{"seed":17}' });
            return { ...edited, metadata: { ...edited.metadata, comic: { ...assets[0].metadata.comic, useUnifiedStyle: false } } };
        });
        const raw = nodeGenerationPrompt(node(assets[0].id));
        await service.submitComicImage(project.id, assets[0].id, { ...config, quality: "high", size: "1536x1024" });
        expect(prepared[0].config.quality).toBe("low"); expect(prepared[0].config.size).toBe("1024x1024");
        expect(prepared[0].config.imageParameters).toBe('{"seed":17}');
        expect(prepared[0].prompt).toBe(raw); expect(prepared[0].prompt).not.toContain(DEFAULT_COMIC_SETTINGS.style);
        expect(nodeGenerationPrompt(node(assets[0].id))).toBe(raw);
    });

    test("native standalone resource references and stable mention tokens participate in image generation", async () => {
        const { project, assets, panels } = setup(true); ready(assets[0].id);
        editNode(panels[0].id, (item) => {
            const spec = readNodeGenerationSpec(item)!;
            return { ...item, metadata: { ...item.metadata, ...generationSpecMetadata({ ...spec, prompt: `@[node:${assets[0].id}] 位于 @[node:external] 的场景。`, referenceBindings: [...spec.referenceBindings, { id: "external", resourceId: "external-image", mediaType: "image", role: "reference", order: 1, resolution: "snapshot" }] }) } };
        });
        const raw = nodeGenerationPrompt(node(panels[0].id));
        await service.submitComicImage(project.id, panels[0].id, config);
        expect(prepared[0].referenceImages?.map((reference) => reference.storageKey)).toEqual([`resource:${assets[0].id}`, "resource:external-image"]);
        expect(prepared[0].prompt).toContain("@图片1 位于 @图片2 的场景。");
        expect(prepared[0].prompt).not.toContain("@[node:");
        expect(nodeGenerationPrompt(node(panels[0].id))).toBe(raw);
        expect(readNodeGenerationSpec(node(panels[0].id))!.referenceBindings[1].resourceId).toBe("external-image");
    });

    test("nonimage canvas context edges are retained but explicit unsupported generation bindings are not silently ignored", async () => {
        const { project, assets, panels, source } = setup(true); ready(assets[0].id);
        const video: CanvasNodeData = { ...assets[0], id: "video-context", type: CanvasNodeType.Video, metadata: { storageKey: "resource:video" } };
        state.updateProject(project.id, { nodes: [...current().nodes, video], connections: [...current().connections, { id: "video-context-edge", fromNodeId: video.id, toNodeId: panels[0].id }] });
        expect(service.comicReferenceIds(node(panels[0].id), current())).toEqual([assets[0].id]);
        editNode(panels[0].id, (item) => {
            const spec = readNodeGenerationSpec(item)!;
            return { ...item, metadata: { ...item.metadata, ...generationSpecMetadata({ ...spec, referenceBindings: [...spec.referenceBindings, { id: "video-binding", nodeId: video.id, mediaType: "video", role: "reference", order: 1, resolution: "latest" }] }) } };
        });
        await expect(service.submitComicImage(project.id, panels[0].id, config)).rejects.toThrow("原画布");
        expect(posted).toHaveLength(0);
        editNode(panels[0].id, (item) => {
            const spec = readNodeGenerationSpec(item)!;
            return { ...item, metadata: { ...item.metadata, ...generationSpecMetadata({ ...spec, referenceBindings: [...spec.referenceBindings.filter((binding) => binding.id !== "video-binding"), { id: "text-context", nodeId: source.id, mediaType: "text", role: "source-text", order: 1, resolution: "latest" }] }) } };
        });
        await service.submitComicImage(project.id, panels[0].id, config);
        expect(prepared[0].referenceImages?.map((reference) => reference.id)).toEqual([assets[0].id]);
        expect(current().connections.some((connection) => connection.id === "video-context-edge")).toBe(true);
        expect(readNodeGenerationSpec(node(panels[0].id))!.referenceBindings.some((binding) => binding.id === "text-context")).toBe(true);
        expect(prepared[0].prompt).not.toContain(sourceText);
    });

    for (const phase of ["input", "cloud"] as const) {
        test(`shared style or per-node style switch changes during ${phase} stop the stale charged submission`, async () => {
            for (const change of ["shared", "toggle"] as const) {
                reset(); const { project, source, assets } = setup(true); const gate = holdPrepare(phase);
                const outcome = service.submitComicImage(project.id, assets[0].id, config).then(() => undefined, (error) => error);
                await gate.entered;
                if (change === "shared") editNode(source.id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...source.metadata.comic, settings: { ...source.metadata.comic.settings, style: "新的水彩风格" } } } }));
                else editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, comic: { ...assets[0].metadata.comic, useUnifiedStyle: false } } }));
                gate.release();
                expect(await outcome).toBeInstanceOf(Error); expect(posted).toHaveLength(0);
                expect(comicImagePrompt(node(assets[0].id), getComicSource(current().nodes))).not.toContain(DEFAULT_COMIC_SETTINGS.style);
            }
        });
    }

    test("version editing refuses unresolved or unsettled receipts and rechecks concurrent task ownership", async () => {
        const { project, assets } = setup(true);
        editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, taskClientOperationId: "pending-op", status: "error" } }));
        await expect(service.assertComicImageEditable(project.id, assets[0].id)).rejects.toThrow("尚未确认");
        editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, taskId: "failed-task" } }));
        const previous = makeTask({ id: "failed-task", status: "failed" }); tasks.set(previous.id, previous);
        listed = [{ ...previous, billing: { amountMicrocredits: 1000, status: "uncertain" } }];
        await expect(service.assertComicImageEditable(project.id, assets[0].id)).rejects.toThrow("结算待确认");
        listed = [{ ...previous, billing: { amountMicrocredits: 1000, status: "refunded" } }];
        await service.assertComicImageEditable(project.id, assets[0].id);
        const entered = deferred(), release = deferred();
        queryHook = async () => { entered.resolve(); await release.promise; return previous; };
        const result = service.assertComicImageEditable(project.id, assets[0].id).then(() => undefined, (error) => error);
        await entered.promise;
        editNode(assets[0].id, (item) => ({ ...item, metadata: { ...item.metadata, taskId: "new-task", taskClientOperationId: "new-op" } }));
        release.resolve();
        expect(await result).toBeInstanceOf(Error); expect(node(assets[0].id).metadata?.taskId).toBe("new-task");
        expect(posted).toHaveLength(0);
    });
});

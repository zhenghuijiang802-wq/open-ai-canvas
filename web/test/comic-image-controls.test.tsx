// Run alone: bun test test/comic-image-controls.test.tsx
// Real hook, generation contracts, reference helpers and media-version helpers;
// only account-scoped stores and I/O are replaced. No model requests are sent.
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import type { AgentCanvasContext } from "../src/stores/use-global-agent-store";
import type { AiConfig } from "../src/stores/use-config-store";
import type { CanvasNodeData } from "../src/types/canvas";
import type { RemoteResource } from "../src/services/api/resources";
import type { ImageAsset } from "../src/stores/use-asset-store";

const dom = new Window({ url: "http://localhost/toolbox/comic" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement,
    Event: dom.Event, CustomEvent: dom.CustomEvent, getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const React = await import("react");
const { act, useSyncExternalStore } = React;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useNavigate } = await import("react-router");
const nativeConfigStore = { ...await import("../src/stores/use-config-store") };
const nativeResources = { ...await import("../src/services/api/resources") };
const nativeImageStorage = { ...await import("../src/services/image-storage") };
const nativeTaskApi = { ...await import("../src/services/api/task-center") };
const { defaultConfig, encodeChannelModel } = nativeConfigStore;
const modelA = encodeChannelModel("test-images", "gpt-image-1");
const modelB = encodeChannelModel("test-images", "gpt-image-1.5");
const config: AiConfig = {
    ...defaultConfig, model: modelA, imageModel: modelA, size: "1024x1024", quality: "high", count: "1",
    apiKey: "PRIVATE_TEST_CREDENTIAL", imageParameters: "{}",
    channels: [{ id: "test-images", name: "图片测试", enabled: true, scope: "user", apiFormat: "openai", interfaceType: "openai-image", apiKey: "PRIVATE_TEST_CREDENTIAL", baseUrl: "https://example.invalid", models: ["gpt-image-1", "gpt-image-1.5"],
        modelCosts: ["gpt-image-1", "gpt-image-1.5"].map((model) => ({ model, capability: "image", protocol: "openai-image", billingMode: "fixed_request", unitPriceMicrocredits: 1 })) }],
};

let cache: CanvasProject[] = [];
const listeners = new Set<() => void>();
const saved = new Map<string, CanvasProject>();
let saveCalls: string[] = [];
let errors: string[] = [];
let guardCalls: Array<[string, string]> = [];
let uploads: Array<{ name: string; kind: string }> = [];
let deleteCalls = 0;
let agentCanvas: AgentCanvasContext | null = null;
let guardHook: () => Promise<void> = async () => {};
let uploadHook: () => Promise<RemoteResource> = async () => resource("uploaded");

function resource(id: string): RemoteResource {
    return { id, userId: "current-account", kind: "image", status: "ready", mimeType: "image/png", width: 800, height: 600, size: 10,
        provider: "local", endpoint: "", bucket: "", objectKey: "", publicUrl: "", createdAt: "", updatedAt: "" };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
const canvasState = {
    get projects() { return cache; },
    updateProject(id: string, patch: Partial<CanvasProject>) {
        cache = cache.map((project) => project.id === id ? { ...project, ...patch } : project);
        listeners.forEach((listener) => listener());
    },
};
const useCanvasStore = Object.assign(<T,>(selector: (state: typeof canvasState) => T) => useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => selector(canvasState), () => selector(canvasState),
), { getState: () => canvasState });
const agentState = { get canvas() { return agentCanvas; }, setCanvas(value: AgentCanvasContext | null) { agentCanvas = value; }, openAgent() {} };
const message = { error: (detail: string) => { errors.push(detail); }, info() {}, warning() {}, success() {} };
mock.module("antd", () => ({ App: { useApp: () => ({ message }) } }));
mock.module("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore }));
// The config resolver imports imageMetadata from the materialization module.
// These controls never materialize model output; keep that I/O boundary closed
// instead of loading its storage/asset-sync/creation controllers and hydration.
mock.module("@/lib/canvas/canvas-generation-task-sync", () => ({
    imageMetadata: () => { throw new Error("No media materialization in control tests"); },
    syncGenerationTaskToCanvasStore: async () => { throw new Error("No media materialization in control tests"); },
}));
mock.module("@/stores/use-global-agent-store", () => ({ useGlobalAgentStore: { getState: () => agentState } }));
mock.module("@/stores/use-config-store", () => ({ ...nativeConfigStore, useEffectiveConfig: () => config }));
mock.module("@/services/user-data-sync", () => ({
    loadCanvasProjectForEditing: async (id: string) => cache.find((project) => project.id === id),
    saveRemoteUserDataNow: async (id: string) => { saveCalls.push(id); saved.set(id, structuredClone(cache.find((project) => project.id === id)!)); },
    prepareCanvasForCloudAction: async () => {}, subscribeAgentCanvasRefresh: () => () => {},
    createCanvasProjectWithRemoteSync: async () => { throw new Error("Unexpected project creation"); },
}));
mock.module("@/services/api/user-data", () => ({ listRemoteCanvasProjectsPage: async () => ({ projects: [], hasMore: false }) }));
mock.module("@/services/api/task-center", () => ({ ...nativeTaskApi, subscribeGenerationTasks: () => () => {}, queryGenerationTask: async () => { throw new Error("Unexpected task query"); } }));
mock.module("@/services/image-storage", () => ({ ...nativeImageStorage, resolveImageUrl: async (key?: string, fallback?: string) => key ? `https://preview.invalid/${encodeURIComponent(key)}` : fallback }));
mock.module("@/services/api/resources", () => ({
    ...nativeResources,
    getResource: async (id: string) => resource(id),
    uploadResourceFile: async (file: File, kind: string) => { uploads.push({ name: file.name, kind }); return uploadHook(); },
    deleteResource: async () => { deleteCalls++; throw new Error("References must not delete resources"); },
}));
const nativeComicService = { ...await import("../src/services/comic-workbench") };
mock.module("@/services/comic-workbench", () => ({
    ...nativeComicService,
    assertComicImageEditable: async (projectId: string, nodeId: string) => { guardCalls.push([projectId, nodeId]); await guardHook(); },
    recoverComicSubmissions: async () => {}, consumeComicTask: async () => {},
    submitComicDerivation: async () => { throw new Error("No model requests in control tests"); },
    submitComicImage: async () => { throw new Error("No model requests in control tests"); },
}));
const { createComicSourceNode, buildComicNodes, getComicAssets, getComicPanels, getComicSource } = await import("../src/lib/canvas/comic-workflow");
const { readNodeGenerationSpec, nodeGenerationPrompt } = await import("../src/lib/canvas/generation-contract");
const { writeCanvasNodePrompt } = await import("../src/lib/canvas/canvas-node-prompt");
const { ensureCurrentMediaVersion } = await import("../src/lib/canvas/canvas-media-versions");
const { comicImagePrompt } = await import("../src/lib/canvas/comic-image-editing");
const { defaultImageCapabilityConfig } = await import("../src/lib/model-capabilities");
const { useComicWorkbench } = await import("../src/pages/workbench/use-comic-workbench");

let latest!: ReturnType<typeof useComicWorkbench>;
let navigate!: ReturnType<typeof useNavigate>;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
let renderErrors: unknown[] = [];
function Probe() {
    latest = useComicWorkbench(); navigate = useNavigate();
    return <output data-project={latest.project?.id || ""} data-busy={String(latest.busy)}>{latest.error}</output>;
}
function project(id: string): CanvasProject {
    const source = createComicSourceNode("主角进入房间。", { style: "水彩线稿", aspectRatio: "3:4", panelCount: 1 });
    source.id = `${id}-source`;
    const graph = buildComicNodes({ assets: [{ id: "hero", name: "主角", kind: "character", prompt: "黑发青年，蓝色外套。" }], panels: [{ id: "enter", title: "进入房间", prompt: "中景，主角推开门走进房间。", sourceExcerpt: "主角进入房间。", assetIds: ["hero"] }] }, source, config);
    const asset = graph.nodes.find((node) => node.metadata?.comic?.role === "asset")!;
    let versioned = ensureCurrentMediaVersion({ ...asset, metadata: { ...asset.metadata, status: "success", storageKey: `resource:${id}-v1`, naturalWidth: 800, naturalHeight: 600 } }, { source: "generate", now: "2026-10-30T00:00:00Z" });
    versioned = ensureCurrentMediaVersion({ ...versioned, metadata: { ...versioned.metadata, storageKey: `resource:${id}-v2`, taskId: "finished-task", taskClientOperationId: "finished-operation", taskStatus: "succeeded" } }, { source: "generate", now: "2026-10-30T00:01:00Z" });
    return { id, title: id, createdAt: "", updatedAt: "", connections: graph.connections, chatSessions: [], activeChatId: null, backgroundMode: "dots", showImageInfo: true, viewport: { x: 0, y: 0, k: 1 }, previsScenes: [], nodes: [source, ...graph.nodes.map((node) => node.id === asset.id ? versioned : node)] };
}
function current(id = "mine") { return cache.find((project) => project.id === id)!; }
function hero() { return getComicAssets(current().nodes)[0]!; }
function panel() { return getComicPanels(current().nodes)[0]!; }
function editNode(id: string, update: (node: CanvasNodeData) => CanvasNodeData) { canvasState.updateProject("mine", { nodes: current().nodes.map((node) => node.id === id ? update(node) : node) }); }
async function mount(id = "mine") {
    host = document.createElement("div"); document.body.append(host);
    root = createRoot(host, { onUncaughtError: (error) => renderErrors.push(error) });
    await act(async () => { root!.render(<MemoryRouter initialEntries={[`/toolbox/comic?project=${id}`]}><Probe /></MemoryRouter>); });
    await settle();
}
async function unmount() {
    if (root) await act(async () => { root!.unmount(); });
    host?.remove(); root = undefined; host = undefined;
}
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
beforeEach(() => {
    for (const cost of config.channels[0].modelCosts!) delete cost.capabilityConfig;
    cache = [project("mine"), project("other")]; saved.clear(); listeners.clear(); saveCalls = []; errors = []; uploads = []; deleteCalls = 0; guardCalls = []; renderErrors = []; agentCanvas = null;
    guardHook = async () => {}; uploadHook = async () => resource("uploaded");
    dom.localStorage.clear(); dom.localStorage.setItem("yingce:active-user-scope", "current-account");
});
afterEach(async () => { await unmount(); });
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

describe("comic image controls persist native document state", () => {
    test("selected uploaded style restores as a readonly reference, follows the switch and deduplicates existing images", async () => {
        await mount();
        const beforeEdges = structuredClone(current().connections), beforeSpec = structuredClone(readNodeGenerationSpec(panel()));
        await act(async () => { latest.setSettings({ ...latest.settings, styleSelection: { id: "watercolor", title: "水彩画风", coverUrl: "/api/resources/style-image/file", referenceResourceId: "style-image" } }); });
        await settle();
        expect(latest.panels[0].references.map((reference) => reference.source)).toEqual(["asset", "style"]);
        expect(latest.panels[0].references[1].id).toBe("comic-style:style-image");
        expect(latest.panels[0].references[1].previewUrl).toContain("resource%3Astyle-image");
        expect(latest.panels[0].referenceAssetIds).toEqual([hero().id]);
        expect(current().connections).toEqual(beforeEdges); expect(readNodeGenerationSpec(panel())).toEqual(beforeSpec);
        await act(async () => { await latest.setNodeUnifiedStyle(panel().id, false); });
        expect(latest.panels[0].references).toHaveLength(1);
        await act(async () => { latest.setSettings({ ...latest.settings, styleSelection: { id: "same-image", title: "同图风格", coverUrl: "/api/resources/mine-v2/file", referenceResourceId: "mine-v2" } }); });
        await act(async () => { await latest.setNodeUnifiedStyle(panel().id, true); });
        expect(latest.panels[0].references).toHaveLength(1); expect(latest.panels[0].references[0].source).toBe("asset");
        expect(latest.panels[0].references[0].title).toContain("同时用于画风");
        expect(latest.panels[0].references[0].id).toBe(hero().id);
        await act(async () => { await latest.save(); });
        await unmount(); cache = [structuredClone(saved.get("mine")!)]; await mount();
        expect(latest.settings.styleSelection?.referenceResourceId).toBe("mine-v2");
        expect(latest.panels[0].references).toHaveLength(1); expect(latest.panels[0].references[0].source).toBe("asset");
        expect(renderErrors).toEqual([]);
    });

    test("source defaults persist only public choices and restore after reload without changing existing node options", async () => {
        await mount();
        const originalNodeSpec = structuredClone(readNodeGenerationSpec(hero()));
        await act(async () => { await latest.updateDefaultImageConfig({ ...config, model: modelB, size: "1536x1024", quality: "medium", imageResolution: "2k", transparentBackground: "true", imageParameters: '{"seed":42,"enhance":false}' }); });
        const defaults = getComicSource(current().nodes)!.metadata.comic.settings.imageDefaults!;
        expect(Object.keys(defaults).sort()).toEqual(["count", "imageParameters", "imageResolution", "model", "quality", "size", "transparentBackground"].sort());
        expect(defaults.model).toBe(modelB); expect(defaults.count).toBe("1");
        expect(JSON.stringify(defaults)).not.toContain("PRIVATE_TEST_CREDENTIAL");
        expect(readNodeGenerationSpec(hero())).toEqual(originalNodeSpec);
        expect(saveCalls).toEqual(["mine"]);
        await unmount();
        cache = [structuredClone(saved.get("mine")!)];
        await mount();
        expect(latest.imageConfig.model).toBe(modelB); expect(latest.imageConfig.size).toBe("1536x1024");
        expect(latest.imageConfig.quality).toBe("medium"); expect(latest.imageConfig.imageResolution).toBe("2k");
        expect(latest.imageConfig.transparentBackground).toBe("true"); expect(latest.imageConfig.imageParameters).toBe('{"seed":42,"enhance":false}');
        expect(renderErrors).toEqual([]);
    });

    test("per-node options and unified style change independently and preserve prompts, versions and connected assets", async () => {
        await mount();
        const id = panel().id, beforePrompt = nodeGenerationPrompt(panel()), beforeEdges = structuredClone(current().connections), beforeHero = structuredClone(hero());
        await act(async () => { await latest.updateImageConfig(id, { ...config, model: modelB, size: "1536x1024", quality: "medium", imageResolution: "2k", transparentBackground: "true", imageParameters: '{"seed":7}' }); });
        const spec = readNodeGenerationSpec(panel())!;
        expect(spec.options.size).toBe("1536x1024"); expect(spec.options.quality).toBe("medium"); expect(spec.options.imageResolution).toBe("2k"); expect(spec.options.transparentBackground).toBe(true); expect(spec.options.imageParameters).toBe('{"seed":7}');
        expect(spec.modelSelection).toEqual({ kind: "channel", channelId: "test-images", modelKey: "gpt-image-1.5" });
        expect(spec.referenceBindings.some((binding) => binding.nodeId === hero().id)).toBe(true);
        await act(async () => { await latest.setNodeUnifiedStyle(id, false); });
        expect(latest.panels[0].useUnifiedStyle).toBe(false); expect(latest.assets[0].useUnifiedStyle).toBe(true);
        expect(nodeGenerationPrompt(panel())).toBe(beforePrompt); expect(current().connections).toEqual(beforeEdges); expect(hero()).toEqual(beforeHero);
        expect(comicImagePrompt(panel(), getComicSource(current().nodes))).toBe(beforePrompt);
        await act(async () => { await latest.setNodeUnifiedStyle(id, true); });
        expect(comicImagePrompt(panel(), getComicSource(current().nodes))).toBe(`画风：水彩线稿\n${beforePrompt}`);
        expect(readNodeGenerationSpec(panel())?.options).toEqual(spec.options); expect(renderErrors).toEqual([]);
    });
});

describe("comic references preserve graph and async ownership", () => {
    const libraryImage = (id: string, resourceId: string): ImageAsset => ({
        id, kind: "image", title: id, coverUrl: "", tags: [], createdAt: "", updatedAt: "",
        data: { storageKey: `resource:${resourceId}`, dataUrl: "", width: 800, height: 600, bytes: 10, mimeType: "image/png" },
    });
    async function onlyStyleReference() {
        const image = defaultImageCapabilityConfig("openai-image", "gpt-image-1");
        image.references.maxImages = 1;
        for (const cost of config.channels[0].modelCosts!) cost.capabilityConfig = { version: 1, image };
        await mount();
        await act(async () => { await latest.removeReference(panel().id, hero().id); });
        await act(async () => { latest.setSettings({ ...latest.settings, styleSelection: { id: "same-image", title: "同图画风", referenceResourceId: "mine-v2" } }); });
        await settle();
        expect(latest.panels[0].references.map((reference) => reference.source)).toEqual(["style"]);
    }
    for (const origin of ["project", "library"] as const) {
        test(`${origin} reference sharing the style resource fits a one-image model without adding a second input`, async () => {
            await onlyStyleReference();
            const id = panel().id, heroId = hero().id;
            await act(async () => {
                if (origin === "project") await latest.addReferenceNodes(id, [heroId, heroId]);
                else await latest.addLibraryReferences(id, [libraryImage("first-copy", "mine-v2"), libraryImage("second-copy", "mine-v2")]);
            });
            expect(errors).toEqual([]); expect(latest.panels[0].references).toHaveLength(1);
            expect(latest.panels[0].references[0].source).toBe("asset");
            expect(latest.panels[0].references[0].title).toContain("同时用于画风");
            expect(latest.panels[0].referenceAssetIds).toEqual([heroId]);
            expect(readNodeGenerationSpec(panel())?.referenceBindings.map((binding) => binding.nodeId)).toEqual([heroId]);
            expect(saved.get("mine")?.connections).toEqual(current().connections);
            expect(uploads).toEqual([]); expect(renderErrors).toEqual([]);
        });

        test(`${origin} reference with a different resource still rejects the style-plus-image overflow`, async () => {
            await onlyStyleReference();
            const different: CanvasNodeData = { ...hero(), id: "different-image", metadata: { ...hero().metadata, comic: undefined, storageKey: "resource:different" } };
            await act(async () => { canvasState.updateProject("mine", { nodes: [...current().nodes, different] }); });
            const before = structuredClone(current());
            let failure: unknown;
            await act(async () => {
                const operation = origin === "project" ? latest.addReferenceNodes(panel().id, [different.id]) : latest.addLibraryReferences(panel().id, [libraryImage("different", "different")]);
                await operation.catch((error) => { failure = error; });
            });
            expect((failure as Error).message).toContain("最多支持 1 张参考图");
            expect(current()).toEqual(before); expect(latest.panels[0].references).toHaveLength(1);
            expect(uploads).toEqual([]); expect(renderErrors).toEqual([]);
        });
    }

    test("unknown uploads retain conservative admission when the style image fills the limit", async () => {
        await onlyStyleReference();
        let failure: unknown;
        await act(async () => { await latest.uploadReferenceFiles(panel().id, [new File(["png"], "unknown.png", { type: "image/png" })]).catch((error) => { failure = error; }); });
        expect((failure as Error).message).toContain("最多支持 1 张参考图");
        expect(uploads).toEqual([]); expect(latest.panels[0].references.map((reference) => reference.source)).toEqual(["style"]);
    });

    test("upload appends a native image reference without losing an intervening prompt edit or automatic asset link; removal keeps the resource", async () => {
        await mount();
        const id = panel().id, automaticEdges = structuredClone(current().connections), entered = deferred<void>(), release = deferred<RemoteResource>();
        uploadHook = async () => { entered.resolve(); return release.promise; };
        let failure: unknown, pending!: Promise<void>;
        await act(async () => { pending = latest.uploadReferenceFiles(id, [new File(["png"], "manual.png", { type: "image/png" })]).catch((error) => { failure = error; }); await entered.promise; });
        await act(async () => { editNode(id, (node) => writeCanvasNodePrompt(node, "AI 新细化的提示词，保留上传。")); });
        await act(async () => { release.resolve(resource("uploaded")); await pending; });
        expect(failure).toBeUndefined(); expect(uploads).toEqual([{ name: "manual.png", kind: "image" }]);
        const added = current().nodes.find((node) => node.metadata?.storageKey === "resource:uploaded")!;
        expect(added.metadata.comic).toBeUndefined(); expect(added.metadata.mediaVersions).toHaveLength(1);
        expect(nodeGenerationPrompt(panel())).toBe("AI 新细化的提示词，保留上传。");
        for (const edge of automaticEdges) expect(current().connections).toContainEqual(edge);
        expect(latest.panels[0].referenceAssetIds).toEqual([hero().id, added.id]);
        expect(readNodeGenerationSpec(panel())?.referenceBindings.map((binding) => binding.nodeId)).toEqual([hero().id, added.id]);
        await act(async () => { await latest.removeReference(id, added.id); });
        expect(latest.panels[0].referenceAssetIds).toEqual([hero().id]);
        expect(current().nodes.some((node) => node.id === added.id && node.metadata?.storageKey === "resource:uploaded")).toBe(true);
        expect(current().connections).toEqual(automaticEdges); expect(deleteCalls).toBe(0); expect(renderErrors).toEqual([]);
    });

    for (const change of ["account", "project"] as const) {
        test(`upload completion after ${change} change cannot attach to either document`, async () => {
            await mount();
            const id = panel().id, before = structuredClone(cache), entered = deferred<void>(), release = deferred<RemoteResource>();
            uploadHook = async () => { entered.resolve(); return release.promise; };
            let failure: unknown, pending!: Promise<void>;
            await act(async () => { pending = latest.uploadReferenceFiles(id, [new File(["png"], "late.png", { type: "image/png" })]).catch((error) => { failure = error; }); await entered.promise; });
            await act(async () => {
                if (change === "account") dom.localStorage.setItem("yingce:active-user-scope", "different-account");
                else navigate("/toolbox/comic?project=other");
            });
            await act(async () => { release.resolve(resource("late")); await pending; });
            expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toContain("切换");
            expect(cache).toEqual(before); expect(saveCalls).toEqual([]); expect(uploads).toHaveLength(1); expect(deleteCalls).toBe(0); expect(renderErrors).toEqual([]);
        });
    }
});

describe("comic native version controls", () => {
    test("adoption waits for the task guard, changes the current image, and lets connected panels use that version", async () => {
        await mount();
        const id = hero().id, before = structuredClone(hero()), edges = structuredClone(current().connections), v1 = hero().metadata.mediaVersions![0], entered = deferred<void>(), release = deferred<void>();
        guardHook = async () => { entered.resolve(); await release.promise; };
        let result: boolean | undefined, pending!: Promise<void>;
        await act(async () => { pending = latest.adoptVersion(id, v1.id).then((value) => { result = value; }); await entered.promise; });
        expect(hero()).toEqual(before); expect(saveCalls).toEqual([]); expect(guardCalls).toEqual([["mine", id]]);
        await act(async () => { release.resolve(); await pending; });
        await settle();
        expect(result).toBe(true); expect(hero().metadata.storageKey).toBe("resource:mine-v1"); expect(hero().metadata.currentMediaVersionId).toBe(v1.id);
        expect(hero().metadata.taskId).toBeUndefined(); expect(hero().metadata.taskClientOperationId).toBeUndefined();
        expect(readNodeGenerationSpec(hero())).toEqual(readNodeGenerationSpec(before)); expect(nodeGenerationPrompt(hero())).toBe(nodeGenerationPrompt(before));
        expect(hero().metadata.mediaVersions).toEqual(before.metadata.mediaVersions); expect(current().connections).toEqual(edges);
        expect(latest.panels[0].referenceAssetIds).toEqual([id]); expect(latest.panels[0].references[0].previewUrl).toContain(encodeURIComponent("resource:mine-v1"));
        expect(saveCalls).toEqual(["mine"]); expect(renderErrors).toEqual([]);
    });

    test("a rejected task guard preserves the current media, receipts, version list and graph", async () => {
        await mount();
        const before = structuredClone(current()), id = hero().id, versionId = hero().metadata.mediaVersions![0].id;
        guardHook = async () => { throw new Error("原任务结算待确认"); };
        let failure: unknown;
        await act(async () => { await latest.adoptVersion(id, versionId).catch((error) => { failure = error; }); });
        expect((failure as Error).message).toContain("结算待确认"); expect(current()).toEqual(before); expect(saveCalls).toEqual([]);
        expect(errors).toContain("原任务结算待确认"); expect(latest.busy).toBe(false); expect(renderErrors).toEqual([]);
    });

    test("extracting a historical image creates an independent canvas image without duplicating a comic asset or its task", async () => {
        await mount();
        const beforeHero = structuredClone(hero()), beforeEdges = structuredClone(current().connections), version = hero().metadata.mediaVersions![0], count = current().nodes.length;
        await act(async () => { expect(await latest.extractVersion(hero().id, version.id)).toBe(true); });
        expect(current().nodes).toHaveLength(count + 1);
        const extracted = current().nodes.at(-1)!;
        expect(extracted.metadata.storageKey).toBe(version.media.storageKey); expect(extracted.metadata.comic).toBeUndefined();
        expect(extracted.metadata.taskId).toBeUndefined(); expect(extracted.metadata.taskClientOperationId).toBeUndefined(); expect(extracted.metadata.mediaVersions).toBeUndefined();
        expect(getComicAssets(current().nodes)).toHaveLength(1); expect(getComicPanels(current().nodes)).toHaveLength(1);
        expect(hero()).toEqual(beforeHero); expect(current().connections).toEqual(beforeEdges); expect(renderErrors).toEqual([]);
    });
});

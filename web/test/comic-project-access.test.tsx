// Run alone: bun test test/comic-project-access.test.tsx
// This is a real hook/router regression suite. API and store mocks are process-local.
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import type { AgentCanvasContext } from "../src/stores/use-global-agent-store";
import type { AiConfig } from "../src/stores/use-config-store";

const dom = new Window({ url: "http://localhost/workbench/comic" });
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
const { MemoryRouter, useLocation, useNavigate } = await import("react-router");
const nativeConfigStore = { ...await import("../src/stores/use-config-store") };
const nativeImageStorage = { ...await import("../src/services/image-storage") };
const nativeTaskApi = { ...await import("../src/services/api/task-center") };
const nativeCanvasReferences = { ...await import("../src/lib/canvas/canvas-resource-references") };
const { ApiError } = await import("../src/services/api/request");

let cache: CanvasProject[] = [];
const listeners = new Set<() => void>();
let cacheDeletes = 0;
let errors: string[] = [];
let saves: string[] = [];
let prepares: string[] = [];
let loads: string[] = [];
let recoveries: string[] = [];
let agentOpened = 0;
let agentCanvas: AgentCanvasContext | null = null;
let recoverFailure: Error | undefined;
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
const requests = new Map<string, Deferred<CanvasProject>>();
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const canvasState = {
    get projects() { return cache; },
    updateProject(id: string, patch: Partial<CanvasProject>) {
        cache = cache.map((project) => project.id === id ? { ...project, ...patch } : project);
        listeners.forEach((listener) => listener());
    },
    deleteProjects(ids: string[]) { cacheDeletes++; cache = cache.filter((project) => !ids.includes(project.id)); listeners.forEach((listener) => listener()); },
    replaceProjects(projects: CanvasProject[]) { cacheDeletes++; cache = projects; listeners.forEach((listener) => listener()); },
};
const useCanvasStore = Object.assign(<T,>(selector: (state: typeof canvasState) => T) => useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => selector(canvasState),
    () => selector(canvasState),
), { getState: () => canvasState });
const agentState = {
    get canvas() { return agentCanvas; },
    setCanvas(value: AgentCanvasContext | null) { agentCanvas = value; },
    openAgent() { agentOpened++; },
};
const message = { error: (detail: string) => { errors.push(detail); }, info() {}, warning() {}, success() {} };
const config = { channels: [], model: "", size: "9:16", count: "1" } as unknown as AiConfig;
mock.module("antd", () => ({ App: { useApp: () => ({ message }) } }));
mock.module("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore }));
mock.module("@/lib/canvas/canvas-generation-task-sync", () => ({
    imageMetadata: () => { throw new Error("No media materialization in access tests"); },
    syncGenerationTaskToCanvasStore: async () => { throw new Error("No media materialization in access tests"); },
}));
mock.module("@/stores/use-global-agent-store", () => ({ useGlobalAgentStore: { getState: () => agentState } }));
mock.module("@/stores/use-config-store", () => ({ ...nativeConfigStore, useEffectiveConfig: () => config, selectableModelsByCapability: () => [] }));
mock.module("@/lib/canvas/canvas-resource-references", () => ({ ...nativeCanvasReferences, buildCanvasAgentMentionReferences: () => [] }));
mock.module("@/services/user-data-sync", () => ({
    loadCanvasProjectForEditing: async (id: string) => { loads.push(id); const request = requests.get(id); if (!request) throw new Error(`Missing test request: ${id}`); return request.promise; },
    saveRemoteUserDataNow: async (id: string) => { saves.push(id); },
    prepareCanvasForCloudAction: async (id: string) => { prepares.push(id); },
    subscribeAgentCanvasRefresh: () => () => {},
    createCanvasProjectWithRemoteSync: async () => { throw new Error("Creation is outside this regression"); },
}));
mock.module("@/services/api/user-data", () => ({ listRemoteCanvasProjectsPage: async () => ({ projects: [], hasMore: false }) }));
mock.module("@/services/api/task-center", () => ({ ...nativeTaskApi, subscribeGenerationTasks: () => () => {}, queryGenerationTask: async () => { throw new Error("Unexpected task query"); } }));
mock.module("@/services/image-storage", () => ({ ...nativeImageStorage, resolveImageUrl: async () => undefined }));
mock.module("@/services/comic-workbench", () => ({
    assertComicImageEditable: async () => {},
    currentComicProject: (id: string) => { const project = cache.find((item) => item.id === id); if (!project) throw new Error("请选择漫画作品"); return project; },
    recoverComicSubmissions: async (id: string) => { recoveries.push(id); if (recoverFailure) throw recoverFailure; },
    comicReferenceIds: () => [], consumeComicTask: async () => {},
    submitComicDerivation: async () => { throw new Error("Unexpected generation"); },
    submitComicImage: async () => { throw new Error("Unexpected generation"); },
}));
const { useComicWorkbench } = await import("../src/pages/workbench/use-comic-workbench");

let latest!: ReturnType<typeof useComicWorkbench>;
let search = "";
let navigate!: ReturnType<typeof useNavigate>;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
let renderErrors: unknown[] = [];
function Probe() {
    latest = useComicWorkbench();
    search = useLocation().search;
    navigate = useNavigate();
    return <output data-loading={String(latest.loading)} data-project={latest.project?.id || ""}>{latest.error}</output>;
}
function project(id: string): CanvasProject {
    return { id, title: id, createdAt: "", updatedAt: "", connections: [], chatSessions: [], activeChatId: null, backgroundMode: "dots", showImageInfo: true, viewport: { x: 0, y: 0, k: 1 }, previsScenes: [],
        nodes: [{ id: `source-${id}`, type: "text", title: "漫画原文", position: { x: 0, y: 0 }, width: 420, height: 360,
            metadata: { content: `缓存正文-${id}`, comic: { version: 1, role: "source", settings: { style: "测试画风", aspectRatio: "9:16", panelCount: 1 } } } }] } as CanvasProject;
}
function request(id: string) { const next = deferred<CanvasProject>(); requests.set(id, next); return next; }
async function mount(url: string) {
    host = document.createElement("div"); document.body.append(host);
    root = createRoot(host, { onUncaughtError: (error) => renderErrors.push(error) });
    await act(async () => { root!.render(<MemoryRouter initialEntries={[url]}><Probe /></MemoryRouter>); });
}
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
function params() { return new URLSearchParams(search); }
beforeEach(() => {
    cache = [project("inaccessible"), project("mine")]; requests.clear(); listeners.clear();
    cacheDeletes = 0; errors = []; saves = []; prepares = []; loads = []; recoveries = []; renderErrors = [];
    agentOpened = 0; agentCanvas = null; recoverFailure = undefined; search = "";
    dom.localStorage.clear(); dom.localStorage.setItem("yingce:active-user-scope", "current-account");
});
afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    host?.remove(); root = undefined; host = undefined;
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("comic project access recovery", () => {
    for (const status of [404, 403]) {
        test(`${status} returns to project selection, preserves query state/cache, and does not remain loading`, async () => {
            const pending = request("inaccessible"), before = structuredClone(cache);
            await mount("/workbench/comic?project=inaccessible&tab=panels&filter=mine&tag=a&tag=b");
            expect(latest.loading).toBe(true);
            await act(async () => { pending.reject(new ApiError("record not found", { status })); });
            await settle();
            expect(params().has("project")).toBe(false);
            expect(params().get("tab")).toBe("panels"); expect(params().get("filter")).toBe("mine"); expect(params().getAll("tag")).toEqual(["a", "b"]);
            expect(latest.loading).toBe(false); expect(latest.project).toBeNull();
            expect(latest.error).toContain("当前账号无权访问"); expect(latest.error).not.toContain("record not found");
            expect(cache).toEqual(before); expect(cacheDeletes).toBe(0);
            expect(latest.projects.some((item) => item.id === "mine")).toBe(true);
            expect(latest.projects.some((item) => item.id === "inaccessible")).toBe(false);
            expect(recoveries).toEqual([]); expect(renderErrors).toEqual([]);
            expect(agentCanvas).toBeNull();
            const saveErrors: unknown[] = [];
            await act(async () => { await latest.save().catch((error) => saveErrors.push(error)); });
            await act(async () => { await latest.refineNode("source-inaccessible").catch((error) => saveErrors.push(error)); });
            expect(saveErrors).toHaveLength(2); expect(saves).toEqual([]); expect(prepares).toEqual([]); expect(agentOpened).toBe(0);
        });
    }

    test("server 500 retains the selected ID and cached document for a later retry", async () => {
        const pending = request("mine"), before = structuredClone(cache);
        await mount("/workbench/comic?project=mine&tab=assets");
        await act(async () => { pending.reject(new ApiError("server unavailable", { status: 500 })); });
        await settle();
        expect(params().get("project")).toBe("mine"); expect(params().get("tab")).toBe("assets");
        expect(latest.loading).toBe(false); expect(latest.project?.id).toBe("mine"); expect(latest.error).toBe("server unavailable");
        expect(cache).toEqual(before); expect(cacheDeletes).toBe(0); expect(renderErrors).toEqual([]);
    });

    test("transport failure is reported without treating the project as inaccessible", async () => {
        const pending = request("mine");
        await mount("/workbench/comic?project=mine&filter=mine");
        await act(async () => { pending.reject(new TypeError("Failed to fetch")); });
        await settle();
        expect(params().get("project")).toBe("mine"); expect(latest.loading).toBe(false);
        expect(latest.error).toBe("Failed to fetch"); expect(cacheDeletes).toBe(0);
        expect(latest.projects.some((item) => item.id === "mine")).toBe(true);
    });

    test("a late 404 for the previous selection cannot clear or overwrite the newly selected project", async () => {
        const oldRequest = request("inaccessible"), newRequest = request("mine");
        await mount("/workbench/comic?project=inaccessible&tab=assets");
        await act(async () => { navigate("/workbench/comic?project=mine&tab=panels&keep=yes"); });
        expect(loads).toEqual(["inaccessible", "mine"]); expect(latest.loading).toBe(true);
        await act(async () => { oldRequest.reject(new ApiError("record not found", { status: 404 })); });
        await settle();
        expect(params().get("project")).toBe("mine"); expect(params().get("tab")).toBe("panels"); expect(params().get("keep")).toBe("yes");
        expect(latest.loading).toBe(true); expect(latest.error).toBe("");
        await act(async () => { newRequest.resolve(cache.find((item) => item.id === "mine")!); });
        await settle();
        expect(params().get("project")).toBe("mine"); expect(latest.project?.id).toBe("mine"); expect(latest.loading).toBe(false);
        expect(recoveries).toEqual(["mine"]); expect(agentCanvas?.canvasId).toBe("mine"); expect(errors).toEqual([]); expect(cacheDeletes).toBe(0);
    });

    test("a task recovery 404 after a successful project load does not discard project access", async () => {
        const pending = request("mine"); recoverFailure = new ApiError("task record not found", { status: 404 });
        await mount("/workbench/comic?project=mine&tab=assets");
        await act(async () => { pending.resolve(cache.find((item) => item.id === "mine")!); });
        await settle();
        expect(params().get("project")).toBe("mine"); expect(latest.project?.id).toBe("mine");
        expect(latest.loading).toBe(false); expect(latest.error).toBe("task record not found");
        expect(cacheDeletes).toBe(0); expect(renderErrors).toEqual([]);
    });
});

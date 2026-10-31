import { describe, expect, test } from "bun:test";
import { normalizeWorkbenchPrompt, removeWorkbenchReferenceToken, resolveWorkbenchAssetResource, restoreWorkbenchPromptTokens, workbenchMentionReference, workbenchReferenceAdmission, type WorkbenchMediaAsset, type WorkbenchReference } from "../src/pages/workbench/workbench-assets";

const reference = (id: string, kind: WorkbenchReference["kind"] = "image", slotKey?: string): WorkbenchReference => ({ id, name: id, kind, previewUrl: "", resourceId: `resource-${id}`, progress: 100, uploading: false, role: "reference", ...(slotKey ? { slotKey } : {}) });
const limits = { image: 2, video: 1, audio: 1 };
const asset = (storageKey?: string): WorkbenchMediaAsset => ({ id: "asset-id-not-resource-id", kind: "image", title: "参考", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { dataUrl: "https://example.com/photo.png", storageKey, mimeType: "image/png", width: 10, height: 10, bytes: 3 } });
const ready = { id: "resource-id", kind: "image", status: "ready" };

describe("workbench asset references", () => {
    test("numbers stable tokens independently for mixed media and rebinds after removal", () => {
        const references = [reference("image-a"), reference("audio-a", "audio"), reference("image-b"), reference("video-a", "video")];
        const prompt = references.map((item) => workbenchMentionReference(item, references).mentionToken).join(" / ");
        expect(normalizeWorkbenchPrompt(prompt, references)).toBe("@图片1 / @音频1 / @图片2 / @视频1");
        expect(normalizeWorkbenchPrompt(removeWorkbenchReferenceToken(prompt, references[0]), references.slice(1))).toBe("/ @音频1 / @图片1 / @视频1");
    });

    test("binds visible labels from restored tasks to their reference identities", () => {
        const references = [reference("a"), reference("b")];
        const prompt = restoreWorkbenchPromptTokens("以@图片2为主体", references);
        expect(normalizeWorkbenchPrompt(prompt, [references[1]])).toBe("以@图片1为主体");
        expect(() => normalizeWorkbenchPrompt("使用@[asset:unknown]", references)).toThrow("素材引用");
        expect(() => normalizeWorkbenchPrompt("使用@[workbench:removed]", references)).toThrow("素材引用");
    });

    test("reserves pending media against model and slot limits", () => {
        const pending = { ...reference("pending", "image", "subject"), resourceId: undefined, uploading: true };
        const slots = [{ key: "subject", name: "主体", mediaTypes: ["image"], maxCount: 1 }, { key: "motion", name: "动作", mediaTypes: ["video"], maxCount: 1 }];
        expect(workbenchReferenceAdmission("image", [pending], limits, slots, "subject").error).toContain("已满");
        expect(workbenchReferenceAdmission("audio", [], limits, slots).error).toContain("不支持");
        expect(workbenchReferenceAdmission("video", [pending], limits, slots)).toEqual({ slotKey: "motion" });
        expect(workbenchReferenceAdmission("video", [reference("video", "video")], limits).error).toContain("数量上限");
        expect(workbenchReferenceAdmission("video", [], { ...limits, video: 0 }).error).toContain("不支持");
    });

    test("reuses only a validated resource ID, never the asset ID", async () => {
        const requested: string[] = [];
        const resolved = await resolveWorkbenchAssetResource(asset("resource:owned-resource"), {
            resource: async (id) => { requested.push(id); return ready; },
            localBlob: async () => { throw new Error("unexpected blob read"); },
            upload: async () => { throw new Error("unexpected upload"); },
            importUrl: async () => { throw new Error("unexpected import"); },
            readUrl: async () => { throw new Error("unexpected fetch"); },
        });
        expect(requested).toEqual(["owned-resource"]);
        expect(resolved.id).toBe("resource-id");
    });

    test("uploads a local blob and checks the resulting resource", async () => {
        const blob = new Blob(["image-bytes"], { type: "image/png" });
        const resolved = await resolveWorkbenchAssetResource(asset("local-image-key"), {
            resource: async () => { throw new Error("unexpected resource lookup"); },
            localBlob: async (key, kind) => { expect([key, kind]).toEqual(["local-image-key", "image"]); return blob; },
            upload: async (file, kind, name) => { expect(file).toBe(blob); expect([kind, name]).toEqual(["image", "参考"]); return ready; },
            importUrl: async () => { throw new Error("unexpected import"); },
            readUrl: async () => { throw new Error("unexpected fetch"); },
        });
        expect(resolved).toEqual(ready);
    });

    test("imports external media and refuses unready or wrong-kind resources", async () => {
        const dependencies = {
            resource: async () => ({ ...ready, status: "pending" }),
            localBlob: async () => null,
            upload: async () => ready,
            importUrl: async (url: string, kind: string) => { expect([url, kind]).toEqual(["https://example.com/photo.png", "image"]); return ready; },
            readUrl: async () => new Blob(),
        };
        expect(await resolveWorkbenchAssetResource(asset(), dependencies)).toEqual(ready);
        await expect(resolveWorkbenchAssetResource(asset("resource:pending"), dependencies)).rejects.toThrow("未就绪");
        await expect(resolveWorkbenchAssetResource(asset("resource:wrong-kind"), { ...dependencies, resource: async () => ({ ...ready, kind: "audio" }) })).rejects.toThrow("媒体类型");
    });
});

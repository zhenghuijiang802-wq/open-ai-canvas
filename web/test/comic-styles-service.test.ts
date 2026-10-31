// Run alone: this suite replaces the native profile/resource APIs in-process.
import { beforeEach, expect, mock, test } from "bun:test";
import type { UserStyleProfile } from "../src/services/api/style-profiles";
import { createStyleProfileSnapshot, serializeStyleProfile } from "../src/lib/canvas/style-profile";

let profiles: UserStyleProfile[] = [];
let saved: string[] = [];
let resourceReads: string[] = [];
let scope = "user-one";
let uploadHook = async () => ({ id: "new-image", kind: "image", status: "ready" });
mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => scope }));
function entity(profileJson: string, id = "style-one", revision = 1): UserStyleProfile {
    return { id, userId: "user-one", name: "风格", description: "", coverUrl: "", tagsJson: "[]", profileJson, favorite: false, revision, createdAt: "", updatedAt: "" };
}
mock.module("@/services/api/style-profiles", () => ({
    listStyleProfiles: async () => ({ profiles }),
    createStyleProfile: async (profileJson: string) => { saved.push(profileJson); return { profile: entity(profileJson, "created-style") }; },
    updateStyleProfile: async (id: string, profileJson: string) => { saved.push(profileJson); return { profile: entity(profileJson, id, 2) }; },
}));
mock.module("@/services/api/resources", () => ({
    resourceFileUrl: (id: string) => `/api/resources/${id}/file`,
    uploadResourceFile: async () => uploadHook(),
    getResource: async (id: string) => { resourceReads.push(id); if (id === "foreign") throw new Error("record not found"); return { id, kind: "image", status: "ready" }; },
}));
const { listComicStyles, saveComicStyle, uploadComicStyleImage } = await import("../src/services/comic-styles");

beforeEach(() => { profiles = []; saved = []; resourceReads = []; scope = "user-one"; uploadHook = async () => ({ id: "new-image", kind: "image", status: "ready" }); });
function profile(prompt = "水彩风格") { return createStyleProfileSnapshot({ presetId: "style-one", title: "水彩", description: "原简介", tags: ["自定义"], prompt, assets: [], source: "user", revision: 1 }); }

test("native style list preserves long prompts and marks them unavailable instead of truncating", async () => {
    profiles = [entity(serializeStyleProfile(profile("画".repeat(1001))))];
    const listed = await listComicStyles();
    expect(listed[0].prompt).toHaveLength(1001); expect(listed[0].disabledReason).toContain("1000");
});

test("uploaded style stores native resource locators and persists an owned reference asset", async () => {
    const image = await uploadComicStyleImage(new File(["image"], "风格.png", { type: "image/png" }));
    expect(image).toEqual({ coverUrl: "/api/resources/new-image/file", referenceResourceId: "new-image" });
    const result = await saveComicStyle({ title: "我的画风", prompt: "稳定线稿和柔和水彩", ...image });
    expect(resourceReads).toEqual(["new-image"]);
    expect(result.referenceResourceId).toBe("new-image"); expect(result.coverUrl).toBe(image.coverUrl);
    const stored = JSON.parse(saved[0]);
    expect(stored.assets[0].referenceResourceIds).toEqual(["new-image"]);
    expect(saved[0]).not.toContain("data:image"); expect(saved[0]).not.toContain("blob:");
});

test("editing changes only requested style fields and preserves native unrelated fields", async () => {
    const previous = profile(); previous.selection = { world: "古风" }; previous.description = "保留描述";
    previous.assets = [{ id: "disabled-module", kind: "prompt", title: "保留模块", provider: "native", status: "draft", enabled: false }];
    profiles = [entity(serializeStyleProfile(previous))];
    await saveComicStyle({ id: "style-one", expectedRevision: 1, title: "新名称", prompt: "新的水墨" });
    const stored = JSON.parse(saved[0]); expect(stored.description).toBe("保留描述"); expect(stored.selection.world).toBe("古风"); expect(stored.assets).toEqual(previous.assets);
    await expect(saveComicStyle({ id: "style-one", expectedRevision: 4, title: "新名称", prompt: "新提示词" })).rejects.toThrow("已被其他操作更新");
    expect(saved).toHaveLength(1);
});

test("unowned resources and account switches cannot be committed to style profiles", async () => {
    await expect(saveComicStyle({ title: "风格", prompt: "水彩", referenceResourceId: "foreign" })).rejects.toThrow("record not found");
    expect(saved).toHaveLength(0);
    uploadHook = async () => { scope = "user-two"; return { id: "new-image", kind: "image", status: "ready" }; };
    await expect(uploadComicStyleImage(new File(["image"], "风格.png", { type: "image/png" }))).rejects.toThrow("账号已切换");
    expect(saved).toHaveLength(0);
});

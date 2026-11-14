import { expect, test } from "bun:test";
import { appendComicStyleReference, comicStyleReference, comicStyleReferenceInstruction, validateComicStyleSelection } from "../src/lib/canvas/comic-style";
import { buildComicNodes, createComicSourceNode, DEFAULT_COMIC_SETTINGS } from "../src/lib/canvas/comic-workflow";
import { defaultConfig } from "../src/stores/use-config-store";
import type { CanvasNodeData } from "../src/types/canvas";

function fixture() {
    const source = createComicSourceNode("小林来到屋顶。", { ...DEFAULT_COMIC_SETTINGS, panelCount: 1 });
    source.metadata.comic.settings.styleSelection = { id: "my-style", title: "水彩", coverUrl: "/api/resources/style-image/file", referenceResourceId: "style-image" };
    const result = buildComicNodes({ assets: [], panels: [{ id: "one", title: "屋顶", prompt: "小林站在屋顶。", assetIds: [], sourceExcerpt: "小林来到屋顶。" }] }, source, defaultConfig);
    return { source, node: result.nodes[0] };
}

test("comic style snapshots reject unstable URLs, foreign fields and unindexable resource IDs", () => {
    const value = { id: "style", title: "水彩", coverUrl: "/comic-style-previews/watercolor.webp", referenceResourceId: "image-1" };
    expect(validateComicStyleSelection(value)).toEqual(value);
    for (const coverUrl of ["data:image/png;base64,abc", "blob:temporary", "https://external.invalid/pic.png", "/api/resources/image-1/file?signature=secret", "/comic-style-previews/../a.webp", `/comic-style-previews/${"x".repeat(81)}.webp`]) expect(() => validateComicStyleSelection({ ...value, coverUrl })).toThrow();
    for (const referenceResourceId of ["x".repeat(81), "../x", "", "资源"]) expect(() => validateComicStyleSelection({ ...value, referenceResourceId })).toThrow();
    expect(() => validateComicStyleSelection({ ...value, rawData: "secret" })).toThrow();
    expect(() => validateComicStyleSelection({ ...value, title: "bad\nname" })).toThrow();
});

test("uploaded style is appended once as a transient input and disabled with unified style", () => {
    const { source, node } = fixture();
    const ordinary = [{ id: "hero", name: "人物", type: "image/png", storageKey: "resource:hero", dataUrl: "" }];
    const styled = appendComicStyleReference(node, source, ordinary);
    expect(styled.references.map((reference) => reference.storageKey)).toEqual(["resource:hero", "resource:style-image"]);
    expect(styled.styleIndex).toBe(1); expect(styled.styleAdded).toBe(true); expect(ordinary).toHaveLength(1);
    expect(comicStyleReferenceInstruction(styled.styleIndex, true)).toContain("@图片2 只参考");
    const disabled: CanvasNodeData = { ...node, metadata: { ...node.metadata, comic: { ...node.metadata.comic, useUnifiedStyle: false } } };
    expect(appendComicStyleReference(disabled, source, ordinary)).toEqual({ references: ordinary, styleIndex: -1, styleAdded: false });
    source.metadata.comic.settings.styleSelection = { id: "builtin", title: "内置", coverUrl: "/comic-style-previews/builtin.webp" };
    expect(comicStyleReference(node, source)).toBeUndefined();
});

test("style references deduplicate resources while retaining original input numbering", () => {
    const { source, node } = fixture();
    const refs = [{ id: "ordinary-style", name: "既有图", type: "image/png", storageKey: "resource:style-image", dataUrl: "" }];
    const styled = appendComicStyleReference(node, source, refs);
    expect(styled.references).toBe(refs); expect(styled.styleIndex).toBe(0); expect(styled.styleAdded).toBe(false);
    expect(comicStyleReferenceInstruction(0, false)).toContain("不额外复制");
    expect(appendComicStyleReference(node, source, [{ ...refs[0], storageKey: undefined, dataUrl: "/api/resources/style-image/file" }]).references).toHaveLength(1);
});

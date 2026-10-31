import { describe, expect, test } from "bun:test";
import { comicDefaultImageConfig, comicImageDefaults, comicImagePrompt, normalizeComicImagePromptReferences, rememberComicPromptStyle, removeComicStandaloneReference, updateComicImageConfig, updateComicImageReferences, validateComicImageDefaults } from "../src/lib/canvas/comic-image-editing";
import { buildComicDerivationPrompt, buildComicNodes, createComicSourceNode, DEFAULT_COMIC_SETTINGS } from "../src/lib/canvas/comic-workflow";
import { generationSpecMetadata, readNodeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { writeCanvasNodePrompt } from "../src/lib/canvas/canvas-node-prompt";
import { adoptMediaVersion, ensureCurrentMediaVersion, recordReplacedMediaVersion } from "../src/lib/canvas/canvas-media-versions";
import { nodeReferenceImage } from "../src/lib/canvas/canvas-project-generation";
import { defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const config = { ...defaultConfig, model: encodeChannelModel("image-channel", "image-model"), size: "1:1", quality: "high", imageResolution: "2K", count: "1", apiKey: "never-store-secret", baseUrl: "https://secret.invalid" };

function fixture() {
    const source = createComicSourceNode("小林来到屋顶。", { ...DEFAULT_COMIC_SETTINGS, panelCount: 1 });
    const result = buildComicNodes({ assets: [{ id: "hero", name: "小林", kind: "character", prompt: "黑发青年，蓝色外套。" }], panels: [{ id: "roof", title: "屋顶", prompt: "小林站在屋顶入口。", assetIds: ["hero"], sourceExcerpt: "小林来到屋顶。" }] }, source, config);
    return { source, asset: result.nodes[0], panel: result.nodes[1], graph: { nodes: [source, ...result.nodes], connections: result.connections } };
}

describe("comic image settings and recipes", () => {
    test("source defaults serialize only public generation settings and restore across new nodes", () => {
        const defaults = comicImageDefaults({ ...config, count: "8", imageParameters: '{"seed":42}' });
        expect(defaults.count).toBe("1");
        expect(defaults.imageParameters).toBe('{"seed":42}');
        expect(JSON.stringify(defaults)).not.toContain("never-store-secret"); expect(JSON.stringify(defaults)).not.toContain("secret.invalid");
        const { source } = fixture();
        source.metadata.comic.settings.imageDefaults = defaults;
        const restored = comicDefaultImageConfig(source, { ...config, model: "other", size: "16:9", quality: "low" });
        expect(restored.model).toBe(config.model); expect(restored.size).toBe("1:1"); expect(restored.quality).toBe("high");
        expect(buildComicDerivationPrompt(source.metadata.content!, source.metadata.comic.settings)).not.toContain("imageDefaults");
        expect(buildComicDerivationPrompt(source.metadata.content!, source.metadata.comic.settings)).not.toContain("image-channel");
        expect(() => validateComicImageDefaults({ apiKey: "secret" })).toThrow("不支持");
        expect(() => validateComicImageDefaults({ imageParameters: '{"nested":{"a":1}}' })).toThrow("只能包含");
        expect(() => validateComicImageDefaults({ count: "2" })).toThrow("一张");
    });

    test("per-node settings preserve canonical prompt, references and completed media", () => {
        const { panel } = fixture();
        panel.metadata!.storageKey = "resource:finished";
        const edited = updateComicImageConfig(panel, { ...config, size: "3:4", quality: "low", imageParameters: '{"seed":8}' });
        const spec = readNodeGenerationSpec(edited)!;
        expect(spec.prompt).toBe(readNodeGenerationSpec(panel)!.prompt);
        expect(spec.referenceBindings).toEqual(readNodeGenerationSpec(panel)!.referenceBindings);
        expect(spec.options.size).toBe("3:4"); expect(spec.options.quality).toBe("low"); expect(spec.options.imageParameters).toBe('{"seed":8}');
        expect(edited.metadata?.storageKey).toBe("resource:finished"); expect(JSON.stringify(edited)).not.toContain("never-store-secret");
    });

    test("style toggles affect submission only, and remembered legacy prefix follows shared style changes", () => {
        const { source, asset } = fixture();
        const base = readNodeGenerationSpec(asset)!.prompt;
        expect(comicImagePrompt(asset, source)).toBe(`画风：${DEFAULT_COMIC_SETTINGS.style}\n${base}`);
        const off: CanvasNodeData = { ...asset, metadata: { ...asset.metadata, comic: { ...asset.metadata.comic, useUnifiedStyle: false } } };
        expect(comicImagePrompt(off, source)).toBe(base);
        expect(readNodeGenerationSpec(off)!.prompt).toBe(base);
        const legacy = writeCanvasNodePrompt({ ...asset, metadata: { ...asset.metadata, comic: { ...asset.metadata.comic, promptStylePrefix: undefined } } }, `画风：${DEFAULT_COMIC_SETTINGS.style}\n${base}`);
        const remembered = rememberComicPromptStyle(legacy, DEFAULT_COMIC_SETTINGS.style);
        source.metadata.comic.settings.style = "水彩手绘";
        expect(comicImagePrompt(remembered, source)).toBe(`画风：水彩手绘\n${base}`);
        expect(readNodeGenerationSpec(remembered)!.prompt).toBe(`画风：${DEFAULT_COMIC_SETTINGS.style}\n${base}`);
        const authored = writeCanvasNodePrompt(asset, "画风：我自己补充的风格\n人物站在远处。");
        expect(comicImagePrompt(authored, source)).toContain("画风：我自己补充的风格");
    });

    test("stable prompt mentions follow current reference order, missing refs fail explicitly", () => {
        const refs = [{ id: "hero", name: "小林" }, { id: "resource-binding", name: "外部参考" }];
        const prompt = "@[node:resource-binding] 中的环境，@[node:hero] 站在中央。";
        expect(normalizeComicImagePromptReferences(prompt, refs)).toBe("@图片2 中的环境，@图片1 站在中央。");
        expect(normalizeComicImagePromptReferences(prompt, [...refs].reverse())).toBe("@图片1 中的环境，@图片2 站在中央。");
        expect(() => normalizeComicImagePromptReferences(prompt, refs.slice(0, 1))).toThrow("未添加或已移除");
        expect(normalizeComicImagePromptReferences("@[workbench:hero]", refs)).toBe("@图片1");
    });
});

describe("comic references and native versions", () => {
    test("reference edits keep text/source edges, retain standalone resources and do not erase other graph contents", () => {
        const { graph, source, asset, panel } = fixture();
        const uploaded: CanvasNodeData = { ...asset, id: "uploaded-reference", title: "上传参考", metadata: { storageKey: "resource:upload", content: "/image" } };
        const video: CanvasNodeData = { ...asset, id: "unrelated-video", type: CanvasNodeType.Video, metadata: { storageKey: "resource:video" } };
        const spec = readNodeGenerationSpec(panel)!;
        graph.nodes = graph.nodes.map((node) => node.id === panel.id ? { ...node, metadata: { ...node.metadata, ...generationSpecMetadata({ ...spec, referenceBindings: [...spec.referenceBindings, { id: "external", resourceId: "remote", mediaType: "image", role: "reference", resolution: "snapshot", order: 1 }] }) } } : node).concat(uploaded, video);
        const videoEdge = { id: "keep-video-context", fromNodeId: video.id, toNodeId: panel.id };
        graph.connections.push(videoEdge);
        const result = updateComicImageReferences(graph, panel.id, [uploaded.id, asset.id]);
        const changed = result.nodes.find((node) => node.id === panel.id)!;
        expect(readNodeGenerationSpec(changed)!.referenceBindings.map((binding) => binding.nodeId || binding.resourceId)).toEqual([uploaded.id, asset.id, "remote"]);
        expect(changed.metadata?.comic?.role === "panel" && changed.metadata.comic.assetNodeIds).toEqual([asset.id]);
        expect(result.connections.some((connection) => connection.fromNodeId === source.id && connection.toNodeId === panel.id)).toBe(true);
        expect(result.nodes.find((node) => node.id === uploaded.id)).toBe(uploaded);
        expect(result.nodes.find((node) => node.id === asset.id)).toBe(asset);
        expect(result.nodes.find((node) => node.id === video.id)).toBe(video);
        expect(result.connections).toContain(videoEdge);
        expect(readNodeGenerationSpec(removeComicStandaloneReference(changed, "external"))!.referenceBindings).toHaveLength(2);
        expect(() => updateComicImageReferences(graph, panel.id, [panel.id])).toThrow("自身");
        expect(() => updateComicImageReferences(graph, panel.id, ["missing"])).toThrow("不存在");
    });

    test("switching native media versions changes downstream reference media and preserves next prompt/settings", () => {
        const { asset } = fixture();
        const first = ensureCurrentMediaVersion({ ...asset, metadata: { ...asset.metadata, status: "success", storageKey: "resource:one" } });
        const second = recordReplacedMediaVersion(first, { ...first, metadata: { ...first.metadata, storageKey: "resource:two", taskId: "old-task" } }, "generate");
        const selected = adoptMediaVersion(second, first.metadata!.currentMediaVersionId!)!;
        expect(nodeReferenceImage(selected)?.storageKey).toBe("resource:one");
        expect(selected.metadata?.taskId).toBeUndefined();
        expect(selected.metadata?.mediaVersions).toHaveLength(2);
        expect(readNodeGenerationSpec(selected)).toEqual(readNodeGenerationSpec(asset));
    });

    test("removing a middle reference preserves later subjects and empty selection clears only reference tokens", () => {
        const { graph, asset, panel } = fixture();
        const second = { ...asset, id: "ref-two" }, third = { ...asset, id: "ref-three" };
        graph.nodes.push(second, third);
        let edited = updateComicImageReferences(graph, panel.id, [asset.id, second.id, third.id]);
        edited.nodes = edited.nodes.map((node) => node.id === panel.id ? writeCanvasNodePrompt(node, "左边@图片1，中间@[node:ref-two]，右边@图片3。保留原文。") : node);
        edited = updateComicImageReferences(edited, panel.id, [asset.id, third.id]);
        let prompt = readNodeGenerationSpec(edited.nodes.find((node) => node.id === panel.id)!)!.prompt;
        expect(prompt).toBe(`左边@[node:${asset.id}]，中间，右边@[node:ref-three]。保留原文。`);
        expect(normalizeComicImagePromptReferences(prompt, [{ id: asset.id, name: "一" }, { id: third.id, name: "三" }])).toBe("左边@图片1，中间，右边@图片2。保留原文。");
        edited = updateComicImageReferences(edited, panel.id, []);
        prompt = readNodeGenerationSpec(edited.nodes.find((node) => node.id === panel.id)!)!.prompt;
        expect(prompt).toBe("左边，中间，右边。保留原文。");
    });

    test("standalone resource removal respects imported binding order and the current canvas node order", () => {
        const { asset, panel } = fixture();
        const spec = readNodeGenerationSpec(panel)!;
        const imported: CanvasNodeData = { ...panel, metadata: { ...panel.metadata, ...generationSpecMetadata({ ...spec, prompt: "@[node:external-early]与@图片3。", referenceBindings: [
            { id: "external-late", resourceId: "late", mediaType: "image", role: "reference", resolution: "snapshot", order: 2 },
            ...spec.referenceBindings,
            { id: "external-early", resourceId: "early", mediaType: "image", role: "reference", resolution: "snapshot", order: 1 },
        ] }) } };
        const removed = removeComicStandaloneReference(imported, "external-early", [asset.id]);
        const prompt = readNodeGenerationSpec(removed)!.prompt;
        expect(prompt).toBe("与@[node:external-late]。");
        expect(normalizeComicImagePromptReferences(prompt, [{ id: asset.id, name: "人物" }, { id: "external-late", name: "后图" }])).toBe("与@图片2。");
        expect(readNodeGenerationSpec(removed)!.referenceBindings.map((binding) => binding.nodeId || binding.resourceId)).toEqual([asset.id, "late"]);
    });
});

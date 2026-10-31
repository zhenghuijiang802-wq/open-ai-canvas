import { expect, test } from "bun:test";
import { groupModelsForPicker, modelChannelLabel } from "../src/lib/model-picker-groups";
import { groupModelsByDisplayName, modelCompatibilityError, modelGroupReferenceLimits, resolveCompatibleModel } from "../src/lib/model-selection";
import { modelQuoteRequest, priceTiersForCurrentSelection, priceTierSummaryLabel } from "../src/lib/model-pricing";
import { systemChannelModelChannels } from "../src/lib/user-session";
import type { PublicChannelCatalog, PublicChannelModel } from "../src/services/api/logical-models";
import { defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, selectableModelsByCapability } from "../src/stores/use-config-store";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { CanvasNodeType } from "../src/types/canvas";

function model(label = "", price = 300000, modelKey = "seedance-2.0", displayName = modelKey === "seedance-2.0" ? "Seedance 2.0" : modelKey): PublicChannelModel {
    return {
        id: `${modelKey}-${label || "default"}`, modelKey, displayName, channelLabel: label,
        description: label ? `${label}的使用说明` : "",
        icon: "ByteDance", capability: "video", protocol: "seedance", available: true,
        pricingMode: "provider", priceLabel: "",
        capabilityConfig: defaultModelCapabilityConfig("seedance", "seedance-2.0"),
        priceTiers: [{ id: "tier", selector: {}, resolution: "*", videoSeconds: 0, billingMode: "per_second", unitPriceMicrocredits: price, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0 }],
    };
}

function fixture() {
    const channels: PublicChannelCatalog[] = [
        { id: "a", name: "正常渠道", displayName: "正常渠道", models: [model()] },
        { id: "b", name: "渠道 B", displayName: "渠道 B", models: [model("优惠渠道-993")] },
        { id: "c", name: "渠道 C", displayName: "渠道 C", models: [model("特惠渠道-730", 200000)] },
    ];
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: systemChannelModelChannels(channels), model: "b::seedance-2.0", videoModel: "b::seedance-2.0" } }).config;
}

test("same model display name stays under each channel and preserves its prices", () => {
    const config = fixture();
    const groups = groupModelsForPicker(config, selectableModelsByCapability(config, "video"));
    expect(groups).toHaveLength(3);
    expect(config.channels.map((channel) => channel.modelCosts![0].description)).toEqual(["", "优惠渠道-993的使用说明", "特惠渠道-730的使用说明"]);
    expect(groups.map((group) => [group.label, group.kind, group.models.map((item) => [item.label, item.models])])).toEqual([
        ["正常渠道", "channel", [["Seedance 2.0", ["a::seedance-2.0"]]]],
        ["渠道 B", "channel", [["Seedance 2.0", ["b::seedance-2.0"]]]],
        ["渠道 C", "channel", [["Seedance 2.0", ["c::seedance-2.0"]]]],
    ]);
    expect(config.channels.map((channel) => priceTierSummaryLabel(priceTiersForCurrentSelection(channel.modelCosts![0].logicalPriceTiers!, "video", config)))).toEqual(["0.3 积分/秒", "0.3 积分/秒", "0.2 积分/秒"]);
});

test("matching display and variant names do not merge different channel identities", () => {
    const channels = systemChannelModelChannels([
        { id: "mita", name: "秘塔", displayName: "秘塔", models: [model("秘塔（满血渠道）", 90_000, "MiniMax H3", "MiniMax H3")] },
        { id: "other", name: "其他供应商", displayName: "其他供应商", models: [model("秘塔（满血渠道）", 80_000, "minimax-h3-alt", "MiniMax H3")] },
    ]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    const groups = groupModelsForPicker(config, selectableModelsByCapability(config, "video"));
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.label)).toEqual(["秘塔", "其他供应商"]);
    expect(groups.flatMap((group) => group.models.map((item) => item.models))).toEqual([["mita::MiniMax H3"], ["other::minimax-h3-alt"]]);
    expect(groups.flatMap((group) => group.models.map((item) => item.label))).toEqual(["MiniMax H3", "MiniMax H3"]);
});

test("catalog projection keeps promotional tags scoped to each channel model", () => {
    const channels = systemChannelModelChannels([
        { id: "a", name: "A", displayName: "A", models: [{ ...model("A", 100_000), tags: [{ text: "限时特价", color: "purple" }] }] },
        { id: "b", name: "B", displayName: "B", models: [{ ...model("B", 200_000), tags: [{ text: "官方1折", color: "gold" }] }] },
    ]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    expect(config.channels[0].modelCosts![0].tags).toEqual([{ text: "限时特价", color: "purple" }]);
    expect(config.channels[1].modelCosts![0].tags).toEqual([{ text: "官方1折", color: "gold" }]);
});

test("selection and quote keep the chosen channel even when another channel is cheaper", () => {
    const config = fixture();
    const value = "b::seedance-2.0";
    expect(resolveCompatibleModel(config, value, { capability: "video" })).toBe(value);
    expect(resolveModelRequestConfig(config, value)).toMatchObject({ channelId: "b", model: "seedance-2.0" });
    expect(modelQuoteRequest(config, value, "video")).toMatchObject({ channelId: "b", modelKey: "seedance-2.0" });
    config.channels[1].modelCosts![0].channelLabel = "新展示名";
    expect(modelChannelLabel(config, value)).toBe("新展示名");
    expect(resolveModelRequestConfig(config, value)).toMatchObject({ channelId: "b", model: "seedance-2.0" });
});

function sameChannelVariants() {
    const channels = systemChannelModelChannels([{ id: "comfy", name: "Comfy", displayName: "Comfy", models: [
        model("高速版", 100_000, "h3-fast", "MiniMax H3"),
        model("多图一致性", 200_000, "h3-multi", "MiniMax H3"),
    ] }]);
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels, model: "comfy::h3-multi", videoModel: "comfy::h3-multi" } }).config;
}

test("same-channel system variants retain explicit model identity through selection, generation and quote", () => {
    const config = sameChannelVariants();
    const options = selectableModelsByCapability(config, "video");
    expect(groupModelsForPicker(config, options)[0].models).toHaveLength(2);
    expect(groupModelsForPicker(config, options)[0].models.map((item) => item.label)).toEqual(["MiniMax H3 · 高速版", "MiniMax H3 · 多图一致性"]);
    expect(groupModelsByDisplayName(config, options).map((group) => group.models)).toEqual(options.map((value) => [value]));
    for (const value of options) {
        expect(resolveCompatibleModel(config, value, { capability: "video" })).toBe(value);
        const generation = buildGenerationConfig(config, {
            id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 100, height: 100,
            metadata: { model: value, generationMode: "video" },
        }, "video");
        expect(generation.model).toBe(value);
        expect(resolveModelRequestConfig(generation, generation.model)).toMatchObject({ channelId: "comfy", model: value.split("::")[1] });
        expect(modelQuoteRequest(config, value, "video")).toMatchObject({ channelId: "comfy", modelKey: value.split("::")[1] });
    }
});

test("same-channel system variants do not borrow capabilities or reroute incompatible selections", () => {
    const config = sameChannelVariants();
    config.channels[0].modelCosts![0].capabilityConfig!.video!.references.maxImages = 0;
    config.channels[0].modelCosts![1].capabilityConfig!.video!.references.maxImages = 2;
    const requirements = { capability: "video" as const, input: { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } };
    expect(modelGroupReferenceLimits(config, "comfy::h3-fast", "video")?.maxImages).toBe(0);
    expect(modelCompatibilityError(config, "comfy::h3-fast", requirements)).not.toBe("");
    expect(resolveCompatibleModel(config, "comfy::h3-fast", requirements)).toBe("");
    expect(resolveCompatibleModel(config, "comfy::h3-multi", requirements)).toBe("comfy::h3-multi");
});

test("one channel contains all its models despite different display names", () => {
    const config = fixture();
    const extra = systemChannelModelChannels([{ id: "volc", name: "火山引擎", displayName: "火山引擎", models: [
        model("Seedance 2 Mini", 300000, "seedance-2-mini", "Seedance 2 Mini"),
        model("Seedance 2.0 Fast", 300000, "seedance-2-fast", "Seedance 2.0 Fast"),
        model("Seedance 2.0", 300000, "seedance-2", "Seedance 2.0"),
    ] }]);
    const groups = groupModelsForPicker({ ...config, channels: extra }, selectableModelsByCapability({ ...config, channels: extra }, "video"));
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("火山引擎");
    expect(groups[0].models.map((item) => item.label)).toEqual(["Seedance 2 Mini", "Seedance 2.0 Fast", "Seedance 2.0"]);
    expect(groups[0].models.map((item) => item.models)).toEqual([["volc::seedance-2-mini"], ["volc::seedance-2-fast"], ["volc::seedance-2"]]);
});

test("group metadata is stable across channel reorder and current selection", () => {
    const config = fixture();
    config.channels[1].modelCosts![0].displayName = "不同展示名";
    config.channels[1].modelCosts![0].icon = "Jimeng";
    const options = selectableModelsByCapability(config, "video");
    const first = groupModelsForPicker(config, options).find((group) => group.channelId === "b")!;
    const reordered = groupModelsForPicker({ ...config, channels: [...config.channels].reverse(), model: "c::seedance-2.0" }, options).find((group) => group.channelId === "b")!;
    expect([reordered.key, reordered.label, reordered.icon]).toEqual([first.key, first.label, first.icon]);
    expect(reordered.models[0].models).toEqual(["b::seedance-2.0"]);
});

test("each channel keeps its own capability restrictions", () => {
    const config = fixture();
    config.channels[0].modelCosts![0].capabilityConfig!.video!.references.maxImages = 0;
    config.channels[1].modelCosts![0].capabilityConfig!.video!.references.maxImages = 2;
    config.channels[1].modelCosts![0].capabilityConfig!.video!.operations = ["image_to_video"];
    const requirements = { capability: "video" as const, input: { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } };
    expect(modelCompatibilityError(config, "a::seedance-2.0", requirements)).not.toBe("");
    expect(modelCompatibilityError(config, "b::seedance-2.0", requirements)).toBe("");
    expect(groupModelsForPicker(config, selectableModelsByCapability(config, "video")).map((group) => group.models.length)).toEqual([1, 1, 1]);
});

test("managed logical models stay in an automatic platform group beside real channels", () => {
    const config = fixture();
    config.channels[1].id = "managed";
    config.channels[1].modelCosts![0].logicalModelId = "logical-test";
    config.channels[2].scope = "user";
    const groups = groupModelsForPicker(config, ["a::seedance-2.0", "managed::seedance-2.0", "c::seedance-2.0"]);
    expect(groups.map((item) => [item.channelId, item.label, item.scope])).toEqual([["a", "正常渠道", "平台服务"], ["managed", "平台自动路由", "平台服务"], ["c", "渠道 C", "我的模型"]]);
    expect(groups[1].models[0].models).toEqual(["managed::seedance-2.0"]);
    expect(groups[0].models).toHaveLength(1);
    expect(groupModelsForPicker(config, [])).toEqual([]);
});

test("duplicate model names are distinguished within their channel without changing identity", () => {
    const channels = systemChannelModelChannels([{ id: "upstream", name: "Provider", displayName: "Provider", models: [
        model("upstream-a", 300000, "a", "未分类"),
        model("upstream-b", 300000, "b", "未分类"),
        model("upstream-c", 300000, "c", "c"),
    ] }]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    const groups = groupModelsForPicker(config, selectableModelsByCapability(config, "video"));
    expect(groups.map((group) => group.label)).toEqual(["Provider"]);
    expect(groups[0].models.map((item) => [item.label, item.models])).toEqual([
        ["未分类 · upstream-a", ["upstream::a"]], ["未分类 · upstream-b", ["upstream::b"]], ["c", ["upstream::c"]],
    ]);
});

test("channels with identical names remain separate and retain the encoded option values", () => {
    const channels = systemChannelModelChannels([
        { id: "provider-a", name: "同名渠道", displayName: "同名渠道", models: [model("线路", 100000, "model/key:rev 1", "同名模型")] },
        { id: "provider-b", name: "同名渠道", displayName: "同名渠道", models: [model("线路", 200000, "model/key:rev 1", "同名模型")] },
    ]);
    channels[1].scope = "user";
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    const values = ["provider-a::model/key:rev 1", "provider-b::model/key:rev 1"];
    const groups = groupModelsForPicker(config, values);
    expect(groups).toHaveLength(2);
    expect(groups[0].key).not.toBe(groups[1].key);
    expect(groups.map((group) => group.models[0])).toEqual(values.map((value) => ({ key: value, label: "同名模型", models: [value] })));
    expect(groups.map((group) => group.scope)).toEqual(["平台服务", "我的模型"]);
    expect(resolveModelRequestConfig(config, values[0])).toMatchObject({ channelId: "provider-a", model: "model/key:rev 1" });
    expect(resolveModelRequestConfig(config, values[1])).toMatchObject({ channelId: "", model: "model/key:rev 1" });
});

test("duplicate variants fall back to model keys when their route labels are identical", () => {
    const config = sameChannelVariants();
    config.channels[0].modelCosts!.forEach((cost) => { cost.channelLabel = "Comfy"; });
    const values = selectableModelsByCapability(config, "video");
    const initial = groupModelsForPicker(config, values)[0];
    expect(initial.models.map((item) => item.label)).toEqual(["MiniMax H3 · h3-fast", "MiniMax H3 · h3-multi"]);
    config.channels[0].modelCosts!.forEach((cost) => { cost.channelLabel = "共用变体名"; });
    const variants = groupModelsForPicker(config, values)[0];
    expect(variants.models.map((item) => item.label)).toEqual(["MiniMax H3 · 共用变体名 · h3-fast", "MiniMax H3 · 共用变体名 · h3-multi"]);
    expect(variants.models.map((item) => item.key)).toEqual(initial.models.map((item) => item.key));
    expect(variants.models.map((item) => item.models)).toEqual(values.map((value) => [value]));
});

test("logical-only catalogs never claim their configured name is a real upstream channel", () => {
    const config = fixture();
    config.channels[0].modelCosts![0].logicalModelId = "logical-only";
    const group = groupModelsForPicker(config, ["a::seedance-2.0"])[0];
    expect(group.label).toBe("平台自动路由");
    expect(group.channelId).toBe("a");
    expect(group.models[0].models).toEqual(["a::seedance-2.0"]);
});

test("an invalid option does not fall back into the first channel", () => {
    const config = fixture();
    const groups = groupModelsForPicker(config, ["missing::seedance-2.0", "a::missing", "a::seedance-2.0", "a::seedance-2.0"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].models.map((item) => item.models)).toEqual([["a::seedance-2.0"]]);
});

test("a generic channel name uses its single consistent public label for readability", () => {
    const channels = systemChannelModelChannels([{ id: "images", name: "系统模型", displayName: "系统模型", models: [
        model(" LensAPI专线 ", 100000, "image-fast", "Image Fast"),
        model("LensAPI专线", 200000, "image-pro", "Image Pro"),
    ] }]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    const values = selectableModelsByCapability(config, "video");
    const group = groupModelsForPicker(config, values)[0];
    expect(group.label).toBe("LensAPI专线");
    expect(group.channelId).toBe("images");
    expect(group.key).toBe(JSON.stringify(["channel", "images"]));
    expect(group.models.map((item) => item.models)).toEqual(values.map((value) => [value]));
    config.channels[0].name = "明确命名的渠道";
    expect(groupModelsForPicker(config, values)[0].label).toBe("明确命名的渠道");
    config.channels[0].name = "系统模型";
    config.channels[0].modelCosts![1].channelLabel = "";
    expect(groupModelsForPicker(config, [values[0]])[0].label).toBe("系统模型");
    const secondCost = config.channels[0].modelCosts!.pop()!;
    expect(groupModelsForPicker(config, [values[0]])[0].label).toBe("系统模型");
    secondCost.channelLabel = "LensAPI专线";
    config.channels[0].modelCosts!.push(secondCost);
    config.channels[0].modelCosts!.forEach((cost) => { cost.logicalModelId = "logical-model"; });
    expect(groupModelsForPicker(config, values)[0].label).toBe("平台自动路由");
});

test("a generic channel with multiple variant labels never borrows the first visible model label", () => {
    const config = sameChannelVariants();
    config.channels[0].name = "系统渠道";
    const values = selectableModelsByCapability(config, "video");
    const group = groupModelsForPicker(config, [values[0]])[0];
    expect(group.label).toBe("系统渠道");
    expect(group.label).not.toBe("高速版");
    expect(group.models[0].models).toEqual([values[0]]);
    expect(groupModelsForPicker(config, values)[0].label).toBe("系统渠道");
});

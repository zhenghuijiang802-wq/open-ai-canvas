import { configuredModelDisplayName, type DisplayModelGroup } from "@/lib/model-selection";
import { decodeChannelModel, modelIcon, modelOptionName, PUBLIC_MODEL_CATALOG_ID, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ModelPickerGroup = {
    key: string;
    channelId: string;
    label: string;
    icon: string;
    scope: string;
    kind: "channel";
    models: DisplayModelGroup[];
};

export { isDirectSystemModel } from "@/lib/model-selection";

export function modelChannelLabel(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (channel.scope === "system") return cost?.channelLabel?.trim() || modelOptionName(value);
    return cost?.channelLabel?.trim() || channel.name || "未命名渠道";
}

// 渠道身份决定一级目录；右侧每个选项保留独立调用身份、能力与售价。
export function groupModelsForPicker(config: AiConfig, options: string[]): ModelPickerGroup[] {
    const groups: ModelPickerGroup[] = [];
    for (const channel of config.channels) {
        const models = [...new Set(options)].filter((value) => {
            const decoded = decodeChannelModel(value);
            return decoded
                ? decoded.channelId === channel.id && channel.models.includes(decoded.model)
                : channel.models.includes(value) && resolveModelChannel(config, value).id === channel.id;
        });
        if (!models.length) continue;
        const labels = models.map((value) => configuredModelDisplayName(config, value));
        const modelGroups = models.map((value, index): DisplayModelGroup => {
            const label = labels[index];
            const duplicates = labels.filter((other) => other.toLocaleLowerCase() === label.toLocaleLowerCase()).length > 1;
            const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
            const variant = cost?.channelLabel?.trim();
            const suffix = variant && variant.toLocaleLowerCase() !== channel.name.trim().toLocaleLowerCase() && variant.toLocaleLowerCase() !== label.toLocaleLowerCase() ? variant : modelOptionName(value);
            return { key: value, label: duplicates ? `${label} · ${suffix}` : label, models: [value] };
        });
        // 相同变体名也不能把两个 SKU 渲染成同一名称。
        const candidateLabels = modelGroups.map((group) => group.label.toLocaleLowerCase());
        for (const [index, group] of modelGroups.entries()) {
            if (candidateLabels.filter((label) => label === candidateLabels[index]).length > 1) group.label += ` · ${modelOptionName(models[index])}`;
        }
        const automaticCatalog = channel.scope === "system" && (channel.id === PUBLIC_MODEL_CATALOG_ID || channel.models.every((model) => Boolean(channel.modelCosts?.find((item) => item.model === model)?.logicalModelId)));
        const channelName = channel.name.trim();
        const genericName = ["", "系统模型", "系统渠道", "未命名渠道", "默认渠道", "平台模型", "平台渠道"].includes(channelName);
        // 只用整个渠道一致的公开标签补全泛名，不从当前可见模型猜测渠道。
        const routeLabels = channel.models.map((model) => channel.modelCosts?.find((cost) => cost.model === model)?.channelLabel?.trim() || "");
        const publicLabels = [...new Set(routeLabels)];
        const channelLabel = genericName && routeLabels.length > 0 && routeLabels.every(Boolean) && publicLabels.length === 1 ? publicLabels[0] : channelName || "未命名渠道";
        groups.push({
            key: JSON.stringify(["channel", channel.id]),
            channelId: channel.id,
            label: automaticCatalog ? "平台自动路由" : channelLabel,
            icon: modelIcon(config, models[0]),
            scope: channel.scope === "system" ? "平台服务" : "我的模型",
            kind: "channel",
            models: modelGroups,
        });
    }
    return groups;
}

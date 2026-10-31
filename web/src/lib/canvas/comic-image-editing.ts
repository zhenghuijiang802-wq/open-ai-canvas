import { createClientUUID } from "@/lib/client-id";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { bindingForNode, generationSpecMetadata, nodeGenerationPrompt, readNodeGenerationSpec, specFromConfig } from "@/lib/canvas/generation-contract";
import { normalizeCanvasNodeMentionTokens, replaceCanvasMentionToken } from "@/lib/canvas/canvas-resource-references";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasComicImageDefaults, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type ComicGraph = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };

export const COMIC_IMAGE_DEFAULT_LIMITS = {
    model: 512, size: 64, quality: 64, imageResolution: 64,
    transparentBackground: 5, count: 2, imageParameters: 32768,
} as const;

export function validateComicImageDefaults(value: unknown): CanvasComicImageDefaults {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("图片默认参数必须为对象");
    const result: CanvasComicImageDefaults = {};
    for (const [key, setting] of Object.entries(value)) {
        if (!Object.hasOwn(COMIC_IMAGE_DEFAULT_LIMITS, key)) throw new Error("图片默认参数包含不支持的字段");
        const field = key as keyof CanvasComicImageDefaults;
        if (typeof setting !== "string" || setting.length > COMIC_IMAGE_DEFAULT_LIMITS[field]) throw new Error("图片默认参数过长或格式无效");
        if (field === "count" && setting !== "1") throw new Error("每次生成一张图片，历史结果保留为版本");
        if (field === "transparentBackground" && setting !== "true" && setting !== "false") throw new Error("透明背景参数无效");
        if (field === "imageParameters" && setting) {
            let decoded: unknown;
            try { decoded = JSON.parse(setting); } catch { throw new Error("模型附加参数必须是 JSON 对象"); }
            if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("模型附加参数必须是 JSON 对象");
            if (Object.values(decoded).some((item) => item !== null && !["string", "number", "boolean"].includes(typeof item))) throw new Error("模型附加参数只能包含文本、数字或开关");
        }
        result[field] = setting;
    }
    return result;
}

/** Persist only public model selection and generation options, never provider credentials. */
export function comicImageDefaults(config: AiConfig): CanvasComicImageDefaults {
    const defaults: CanvasComicImageDefaults = {};
    for (const key of Object.keys(COMIC_IMAGE_DEFAULT_LIMITS) as Array<keyof CanvasComicImageDefaults>) {
        const value = key === "count" ? "1" : config[key];
        if (typeof value === "string" && value.length <= COMIC_IMAGE_DEFAULT_LIMITS[key]) defaults[key] = value;
        else if (value !== undefined) throw new Error("图片参数过长或格式无效，请重新确认");
    }
    return validateComicImageDefaults(defaults);
}

export function comicDefaultImageConfig(source: CanvasNodeData | undefined, base: AiConfig): AiConfig {
    const settings = source?.metadata?.comic?.role === "source" ? source.metadata.comic.settings : undefined;
    const defaults = settings?.imageDefaults === undefined ? {} : validateComicImageDefaults(settings.imageDefaults);
    return { ...base, size: settings?.aspectRatio || base.size, ...defaults, count: "1" };
}

export function comicImageConfig(node: CanvasNodeData, base: AiConfig, displayOnly = true): AiConfig {
    return { ...buildGenerationConfig(base, node, "image", undefined, displayOnly), count: "1" };
}

export function updateComicImageConfig(node: CanvasNodeData, config: AiConfig): CanvasNodeData {
    if (node.type !== CanvasNodeType.Image || !["asset", "panel"].includes(node.metadata?.comic?.role || "")) throw new Error("请选择漫画资产或分镜");
    const current = readNodeGenerationSpec(node);
    return { ...node, metadata: { ...node.metadata, ...generationSpecMetadata(specFromConfig("image", nodeGenerationPrompt(node), { ...config, count: "1" }, current?.referenceBindings || [], "prompt-only")) } };
}

/** Capture before a shared style edit, so an old automatic prefix cannot pin the old style. */
export function rememberComicPromptStyle(node: CanvasNodeData, sourceStyle: string): CanvasNodeData {
    const comic = node.metadata?.comic;
    if (!comic || comic.role === "source" || comic.promptStylePrefix !== undefined) return node;
    const prefix = sourceStyle && nodeGenerationPrompt(node).startsWith(`画风：${sourceStyle}\n`) ? sourceStyle : "";
    return { ...node, metadata: { ...node.metadata, comic: { ...comic, promptStylePrefix: prefix } } };
}

/** A submission recipe; the canonical editable prompt remains untouched. */
export function comicImagePrompt(node: CanvasNodeData, source: CanvasNodeData | undefined): string {
    const comic = node.metadata?.comic;
    const style = source?.metadata?.comic?.role === "source" ? source.metadata.comic.settings.style : "";
    const rawPrompt = nodeGenerationPrompt(node);
    if (!comic || comic.role === "source") return rawPrompt;
    const legacyPrefix = comic.promptStylePrefix ?? (style && rawPrompt.startsWith(`画风：${style}\n`) ? style : "");
    const autoPrefix = legacyPrefix ? `画风：${legacyPrefix}\n` : "";
    const prompt = autoPrefix && rawPrompt.startsWith(autoPrefix) ? rawPrompt.slice(autoPrefix.length) : rawPrompt;
    return comic.useUnifiedStyle !== false && style.trim() ? `画风：${style.trim()}\n${prompt}` : prompt;
}

export function normalizeComicImagePromptReferences(prompt: string, references: Array<{ id: string; name: string }>): string {
    const tokens = references.map((reference, order) => ({ id: reference.id, nodeId: reference.id, kind: "image" as const, label: `图片${order + 1}`, title: reference.name, active: true }));
    let value = normalizeCanvasNodeMentionTokens(prompt, tokens);
    for (const reference of tokens) value = value.split(`@[workbench:${reference.id}]`).join(`@${reference.label}`);
    if (/@\[(?:workbench|asset|attachment|node):[^\]]*\]/u.test(value)) throw new Error("提示词包含未添加或已移除的参考图，请重新选择");
    return value.trim();
}

export function comicImageReferenceIds(node: CanvasNodeData, project: ComicGraph): string[] {
    return [...new Set(project.connections.filter((connection) => {
        if (connection.toNodeId !== node.id) return false;
        const source = project.nodes.find((entry) => entry.id === connection.fromNodeId);
        return !source || source.type === CanvasNodeType.Image;
    }).map((connection) => connection.fromNodeId))];
}

function referenceOrder(node: CanvasNodeData, nodeIds?: string[]): string[] {
    const bindings = [...(readNodeGenerationSpec(node)?.referenceBindings || [])].sort((a, b) => a.order - b.order);
    return [
        ...(nodeIds || bindings.filter((binding) => binding.nodeId && binding.mediaType === "image").map((binding) => binding.nodeId!)),
        ...bindings.filter((binding) => !binding.nodeId && binding.role !== "source-text").map((binding) => binding.id),
    ];
}

/** Keep surviving subjects stable when slots move, using the native numbered-token boundary. */
function synchronizeReferencePrompt(node: CanvasNodeData, previousIds: string[], nextIds: string[]): CanvasNodeData {
    if (JSON.stringify(previousIds) === JSON.stringify(nextIds)) return node;
    const previousPrompt = nodeGenerationPrompt(node);
    let prompt = previousPrompt;
    for (const [index, id] of previousIds.entries()) {
        prompt = replaceCanvasMentionToken(prompt, `@图片${index + 1}`, `@[node:${id}]`).split(`@[workbench:${id}]`).join(`@[node:${id}]`);
    }
    const remaining = new Set(nextIds);
    for (const id of previousIds) if (!remaining.has(id)) prompt = prompt.split(`@[node:${id}]`).join("");
    return prompt === previousPrompt ? node : writeCanvasNodePrompt(node, prompt);
}

export function updateComicImageReferences(project: ComicGraph, nodeId: string, referenceNodeIds: string[]): ComicGraph {
    const target = project.nodes.find((node) => node.id === nodeId);
    if (!target || target.type !== CanvasNodeType.Image || !["asset", "panel"].includes(target.metadata?.comic?.role || "")) throw new Error("请选择漫画资产或分镜");
    if (new Set(referenceNodeIds).size !== referenceNodeIds.length || referenceNodeIds.includes(nodeId)) throw new Error("参考图不能重复或引用自身");
    const references = referenceNodeIds.map((id) => {
        const node = project.nodes.find((item) => item.id === id);
        if (!node || node.type !== CanvasNodeType.Image) throw new Error("参考图不存在，请重新选择");
        return node;
    });
    const spec = readNodeGenerationSpec(target);
    if (!spec) throw new Error("图片生成参数不存在");
    const retainedBindings = spec.referenceBindings.filter((binding) => !binding.nodeId || binding.mediaType !== "image").sort((a, b) => a.order - b.order);
    const referenceBindings = [
        ...references.map((node, order) => bindingForNode(node, order, spec.referenceBindings.find((binding) => binding.nodeId === node.id))!),
        ...retainedBindings.map((binding, index) => ({ ...binding, order: references.length + index })),
    ];
    const connections = project.connections.filter((connection) => {
        if (connection.toNodeId !== nodeId) return true;
        const source = project.nodes.find((node) => node.id === connection.fromNodeId);
        return Boolean(source && source.type !== CanvasNodeType.Image);
    });
    for (const id of referenceNodeIds) {
        const existing = project.connections.find((connection) => connection.fromNodeId === id && connection.toNodeId === nodeId);
        connections.push(existing || { id: createClientUUID(), fromNodeId: id, toNodeId: nodeId });
    }
    const nextTarget: CanvasNodeData = {
        ...target,
        metadata: {
            ...target.metadata,
            ...generationSpecMetadata({ ...spec, referenceBindings }),
            comic: target.metadata!.comic!.role === "panel" ? { ...target.metadata!.comic!, assetNodeIds: references.filter((item) => item.metadata?.comic?.role === "asset").map((item) => item.id) } : target.metadata!.comic,
        },
    };
    const updated = synchronizeReferencePrompt(nextTarget, referenceOrder(target, comicImageReferenceIds(target, project)), referenceOrder(nextTarget, referenceNodeIds));
    return {
        nodes: project.nodes.map((node) => node.id !== nodeId ? node : updated),
        connections,
    };
}

export function removeComicStandaloneReference(node: CanvasNodeData, bindingId: string, referenceNodeIds?: string[]): CanvasNodeData {
    const spec = readNodeGenerationSpec(node);
    if (!spec) throw new Error("图片生成参数不存在");
    const next: CanvasNodeData = {
            ...node,
            metadata: { ...node.metadata, ...generationSpecMetadata({ ...spec, referenceBindings: spec.referenceBindings.filter((binding) => binding.nodeId || binding.id !== bindingId).sort((a, b) => a.order - b.order).map((binding, order) => ({ ...binding, order })) }) },
    };
    return synchronizeReferencePrompt(next, referenceOrder(node, referenceNodeIds), referenceOrder(next, referenceNodeIds));
}

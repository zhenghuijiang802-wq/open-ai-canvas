import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Asset } from "@/stores/use-asset-store";
import { getResource, importResourceFromUrl, resourceIdFromStorageKey, uploadResourceFile } from "@/services/api/resources";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";

export type WorkbenchMediaKind = "image" | "video" | "audio";
export type WorkbenchMediaAsset = Extract<Asset, { kind: WorkbenchMediaKind }>;
export type WorkbenchReference = {
    id: string;
    name: string;
    kind: WorkbenchMediaKind;
    resourceId?: string;
    assetId?: string;
    previewUrl: string;
    progress: number;
    uploading: boolean;
    error?: string;
    role: "reference" | "first_frame" | "last_frame";
    slotKey?: string;
};
export type WorkbenchReferenceLimits = Record<WorkbenchMediaKind, number>;
type ReferenceSlot = { key: string; name: string; mediaTypes: string[]; maxCount: number };
const kindLabels = { image: "图片", video: "视频", audio: "音频" };

export function isWorkbenchMediaAsset(asset: Asset): asset is WorkbenchMediaAsset {
    return asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
}

export function workbenchReferenceAdmission(kind: WorkbenchMediaKind, references: WorkbenchReference[], limits: WorkbenchReferenceLimits, slots: ReferenceSlot[] = [], slotKey?: string): { slotKey?: string; error?: string } {
    if (limits[kind] <= 0) return { error: `当前模型不支持参考${kindLabels[kind]}` };
    if (references.filter((reference) => reference.kind === kind).length >= limits[kind]) return { error: `已达到当前模型的参考${kindLabels[kind]}数量上限` };
    if (!slots.length) return slotKey ? { error: "输入槽位已不存在，请重新选择" } : {};
    const candidates = slotKey ? slots.filter((slot) => slot.key === slotKey) : slots;
    const compatible = candidates.filter((slot) => slot.mediaTypes.includes(kind));
    if (!compatible.length) return { error: `当前输入槽位不支持${kindLabels[kind]}` };
    const available = compatible.find((slot) => references.filter((reference) => reference.slotKey === slot.key).length < slot.maxCount);
    return available ? { slotKey: available.key } : { error: "当前输入槽位的素材数量已满" };
}

export function workbenchMentionReference(reference: WorkbenchReference, references: WorkbenchReference[]): CanvasResourceReference {
    const position = references.filter((item) => item.kind === reference.kind).findIndex((item) => item.id === reference.id) + 1;
    return {
        id: reference.id,
        nodeId: reference.id,
        kind: reference.kind,
        label: `${kindLabels[reference.kind]}${position}`,
        title: reference.name,
        previewUrl: reference.previewUrl,
        storageKey: reference.resourceId ? `resource:${reference.resourceId}` : undefined,
        mentionToken: `@[workbench:${reference.id}]`,
        active: true,
    };
}

export function removeWorkbenchReferenceToken(prompt: string, reference: WorkbenchReference) {
    return prompt.split(`@[workbench:${reference.id}]`).join("").split(`@[node:${reference.id}]`).join("");
}

export function normalizeWorkbenchPrompt(prompt: string, references: WorkbenchReference[]) {
    let value = prompt;
    for (const reference of references) {
        const mention = workbenchMentionReference(reference, references);
        value = value.split(mention.mentionToken!).join(`@${mention.label}`).split(`@[node:${reference.id}]`).join(`@${mention.label}`);
    }
    if (/@\[(?:workbench|asset|attachment|node):[^\]]*\]/u.test(value)) throw new Error("提示词包含未添加或已移除的素材引用，请重新选择");
    return value.trim();
}

export function restoreWorkbenchPromptTokens(prompt: string, references: WorkbenchReference[]) {
    return prompt.replace(/@(图片|视频|音频)([1-9]\d*)(?!\d)/gu, (token, label: string, position: string) => {
        const kind = label === "图片" ? "image" : label === "视频" ? "video" : "audio";
        const reference = references.filter((item) => item.kind === kind)[Number(position) - 1];
        return reference ? `@[workbench:${reference.id}]` : token;
    });
}

type ReadyResource = { id: string; kind: string; status: string };
type AssetResourceDependencies = {
    resource: (id: string) => Promise<ReadyResource>;
    localBlob: (key: string, kind: WorkbenchMediaKind) => Promise<Blob | null>;
    upload: (blob: Blob, kind: WorkbenchMediaKind, name: string) => Promise<ReadyResource>;
    importUrl: (url: string, kind: WorkbenchMediaKind) => Promise<ReadyResource>;
    readUrl: (url: string) => Promise<Blob>;
};
const resourceDependencies: AssetResourceDependencies = {
    resource: getResource,
    localBlob: (key, kind) => kind === "image" ? getImageBlob(key) : getMediaBlob(key),
    upload: (blob, kind, name) => uploadResourceFile(blob, kind, { fileName: name }),
    importUrl: importResourceFromUrl,
    readUrl: async (url) => {
        const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`素材读取失败（${response.status}）`);
        return response.blob();
    },
};

export async function resolveWorkbenchAssetResource(asset: WorkbenchMediaAsset, dependencies = resourceDependencies): Promise<ReadyResource> {
    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
    let resource: ReadyResource;
    if (resourceId) resource = await dependencies.resource(resourceId);
    else {
        const blob = asset.data.storageKey ? await dependencies.localBlob(asset.data.storageKey, asset.kind) : null;
        const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        if (blob) resource = await dependencies.upload(blob, asset.kind, asset.title);
        else if (/^https?:\/\//i.test(url)) resource = await dependencies.importUrl(url, asset.kind);
        else if (/^(data:|blob:)/i.test(url)) resource = await dependencies.upload(await dependencies.readUrl(url), asset.kind, asset.title);
        else throw new Error("素材原文件不可用，请先上传到资产库");
    }
    if (!resource.id || resource.status !== "ready" || resource.kind !== asset.kind) throw new Error("素材资源未就绪或媒体类型不匹配");
    return resource;
}

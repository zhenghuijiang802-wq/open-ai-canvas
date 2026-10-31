import type { CanvasComicStyleSelection, CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

const resourceIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const resourceCoverPattern = /^\/api\/resources\/([A-Za-z0-9_-]{1,80})\/file$/;
const builtinCoverPattern = /^\/comic-style-previews\/[A-Za-z0-9_-]{1,80}\.webp$/;

export function validateComicStyleSelection(value: unknown): CanvasComicStyleSelection {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("画风选择必须为对象");
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["id", "title", "coverUrl", "referenceResourceId"].includes(key))) throw new Error("画风选择包含不支持的字段");
    for (const key of ["id", "title"] as const) {
        const text = raw[key];
        if (typeof text !== "string" || !text.trim() || text !== text.trim() || Array.from(text).length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) throw new Error("画风标识和名称须为 1–200 字有效文本");
    }
    if (raw.coverUrl !== undefined && (typeof raw.coverUrl !== "string" || raw.coverUrl.length > 512 || (!resourceCoverPattern.test(raw.coverUrl) && !builtinCoverPattern.test(raw.coverUrl)))) throw new Error("画风封面须为已上传资源或内置预览图片");
    if (raw.referenceResourceId !== undefined && (typeof raw.referenceResourceId !== "string" || !resourceIdPattern.test(raw.referenceResourceId))) throw new Error("画风参考图资源标识无效");
    return { id: raw.id as string, title: raw.title as string, ...(raw.coverUrl !== undefined ? { coverUrl: raw.coverUrl as string } : {}), ...(raw.referenceResourceId !== undefined ? { referenceResourceId: raw.referenceResourceId as string } : {}) };
}

export function comicStyleReference(node: CanvasNodeData, source: CanvasNodeData | undefined): ReferenceImage | undefined {
    const comic = node.metadata?.comic;
    if (!comic || comic.role === "source" || comic.useUnifiedStyle === false || source?.metadata?.comic?.role !== "source") return undefined;
    const selected = source.metadata.comic.settings.styleSelection;
    if (!selected) return undefined;
    const style = validateComicStyleSelection(selected);
    if (!style.referenceResourceId) return undefined;
    return { id: `comic-style:${style.referenceResourceId}`, name: `${style.title} · 画风参考`, type: "image/png", storageKey: `resource:${style.referenceResourceId}`, dataUrl: "" };
}

function referenceResourceId(reference: ReferenceImage) {
    const stored = reference.storageKey;
    if (stored?.startsWith("resource:") && resourceIdPattern.test(stored.slice(9))) return stored.slice(9);
    return resourceCoverPattern.exec(reference.dataUrl || "")?.[1] || resourceCoverPattern.exec(reference.url || "")?.[1];
}

/** A style image is a submission-only input, never a persistent node reference binding. */
export function appendComicStyleReference(node: CanvasNodeData, source: CanvasNodeData | undefined, references: ReferenceImage[]) {
    const style = comicStyleReference(node, source);
    if (!style) return { references, styleIndex: -1, styleAdded: false };
    const duplicate = references.findIndex((reference) => referenceResourceId(reference) === referenceResourceId(style));
    if (duplicate >= 0) return { references, styleIndex: duplicate, styleAdded: false };
    return { references: [...references, style], styleIndex: references.length, styleAdded: true };
}

export function comicStyleReferenceInstruction(styleIndex: number, styleAdded: boolean): string {
    if (styleIndex < 0) return "";
    return styleAdded
        ? `画风参考说明：@图片${styleIndex + 1} 只参考线条、色彩、笔触和材质，不复制其中的人物、物品、场景或构图。具体主体与内容以本条提示词及其余参考资产为准。`
        : `画风参考说明：@图片${styleIndex + 1} 同时提供线条、色彩、笔触和材质参考；保留本条提示词明确要求的资产身份，不额外复制参考图中的无关主体或构图。`;
}

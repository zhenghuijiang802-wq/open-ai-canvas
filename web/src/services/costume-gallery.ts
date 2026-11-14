import { costumeImageUrl, parseCostumeCatalog } from "@/lib/costume-gallery";

export async function loadCostumeCatalog(signal: AbortSignal) {
    const response = await fetch("/costume-gallery/catalog.json", { signal, credentials: "omit" });
    if (!response.ok) throw new Error("服装目录加载失败，请重试");
    return parseCostumeCatalog(await response.json());
}

export async function downloadCostume(id: string, signal: AbortSignal) {
    const response = await fetch(costumeImageUrl(id, "png"), { signal, credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error("服装原图读取失败，请重试");
    if (Number(response.headers.get("content-length")) > 20 * 1024 * 1024) throw new Error("服装图片超过 20 MB");
    const blob = await response.blob();
    if (blob.type !== "image/png" || !blob.size || blob.size > 20 * 1024 * 1024) throw new Error("服装原图格式或大小无效");
    signal.throwIfAborted();
    return new File([blob], `服装-${id}.png`, { type: "image/png" });
}

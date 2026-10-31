import { nanoid } from "nanoid";
import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { AssetSourceProvider, ExternalAssetItem, PluginHostContext, PluginManifestV2, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { uploadImage } from "@/services/image-storage";
import { createCatalog, DEFAULT_BASE, DEFAULT_SYSTEMS, ID, select } from "./core.js";
import type { PoseRow } from "./core.js";
import manifest from "./manifest.json";

export function catalogFor(config: Readonly<Record<string, string | number | boolean>>) {
    const base = typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_BASE;
    const systems = typeof config.systems === "string" && config.systems.trim() ? config.systems.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_SYSTEMS;
    return createCatalog({ base, systems });
}
export function toItem(row: PoseRow): ExternalAssetItem {
    return { id: row.id, title: `${row.title} · ${row.angle}`, kind: "image", thumbnailUrl: row.thumbnailUrl, fileUrl: row.fileUrl,
        tags: [row.system, row.category, row.angle, row.code], folderId: `${row.system}/${row.category}`, folderPath: [row.system,row.category],
        description: `${row.code} · ${row.angle}`, metadata: { poseId: row.id, source: "wquguru/shisei (CC0 1.0)" } };
}
export function createPoseAssetSource(context: PluginHostContext): AssetSourceProvider {
    const catalog = catalogFor(context.config);
    const requirePermission = (permission: "asset.read" | "asset.search" | "asset.import") => {
        if (!context.permissions.has(permission)) throw new Error(`姿势图库缺少 ${permission} 权限`);
    };
    return {
        listFolders: async (signal) => {
            requirePermission("asset.read");
            return [...new Set((await catalog.load(signal)).map(r => `${r.system}/${r.category}`))].map(id => ({ id, name: id }));
        },
        list: async (query) => {
            requirePermission("asset.search");
            if (query.kind && query.kind !== "image") return [];
            let rows = await catalog.load(query.signal);
            if (query.folderId) rows = rows.filter(r => `${r.system}/${r.category}` === query.folderId);
            if (query.tags?.length) rows = rows.filter(r => query.tags!.every(tag => [r.system,r.category,r.angle,r.code].includes(tag)));
            return select(rows, { keyword: query.keyword, offset: query.offset, limit: query.limit ?? 200 }).rows.map(toItem);
        },
        importAsset: async (item, signal) => {
            requirePermission("asset.import"); signal?.throwIfAborted();
            const row = (await catalog.load(signal)).find(r => r.id === item.id);
            if (!row) throw new Error("姿势不属于当前图库");
            // Resolve the ID against the catalog; never download a caller-supplied URL.
            const blob = await catalog.download(row.id, signal); signal?.throwIfAborted();
            const uploaded = await uploadImage(blob); signal?.throwIfAborted();
            const now = new Date().toISOString();
            return { id: nanoid(), kind: "image", title: `${row.title} · ${row.angle}`, coverUrl: uploaded.url, tags:[row.system,row.category,row.angle],
                source: "AI姿势参考图库", createdAt: now, updatedAt: now,
                metadata: { poseId:row.id, sourceUrl:row.fileUrl, sourceProject:"https://github.com/wquguru/shisei", rightsNotice:"CC0 1.0 公有领域协议，完全支持商业使用" },
                data: { dataUrl:uploaded.url, storageKey:uploaded.storageKey, width:uploaded.width, height:uploaded.height, bytes:uploaded.bytes, mimeType:uploaded.mimeType } };
        },
    };
}
export const poseGalleryPlugin: RegisteredPlugin = {
    manifest: { ...manifest, runtime: { web: "trusted-backend" }, entry: undefined } as PluginManifestV2,
    source: "bundled-custom",
    createAssetSource: createPoseAssetSource,
};
registerPlugin(poseGalleryPlugin);
export { ID };

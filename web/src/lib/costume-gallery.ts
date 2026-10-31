export const COSTUME_GALLERY_URL = "https://ai-costume-gallery.pages.dev/";
export const COSTUME_CATEGORIES: Record<string, string> = { 春: "春装", 夏: "夏装", 秋: "秋装", 冬: "冬装", ランジェリー: "内衣", パーティ: "礼服", 水着: "泳装", セクシー: "性感服装" };
export type Costume = { id: string; category: string; keywords: string };
const words: Record<string, string> = { 白色: "white", 黑色: "black", 红色: "red", 蓝色: "blue", 粉色: "pink", 绿色: "green", 裙子: "skirt", 连衣裙: "dress", 外套: "coat", 衬衫: "shirt", 毛衣: "sweater", 牛仔: "denim", 蕾丝: "lace", 靴子: "boots", 运动鞋: "sneakers", 高跟鞋: "heels", 帽子: "hat", 丝袜: "stockings", 手套: "gloves", 夹克: "jacket", 丝绸: "satin", 皮革: "leather", 短裤: "shorts", 长裤: "pants", 兔女郎: "bunny" };
export function parseCostumeCatalog(value: unknown): Costume[] {
    if (!Array.isArray(value) || value.length > 10000) throw new Error("服装目录格式无效");
    const ids = new Set<string>();
    return value.map((row) => {
        if (!row || typeof row !== "object" || typeof row.id !== "string" || !/^[A-Z]{3}-\d{4}$/.test(row.id) || ids.has(row.id) || !Object.hasOwn(COSTUME_CATEGORIES, row.category) || typeof row.keywords !== "string" || row.keywords.length > 1000) throw new Error("服装目录条目无效");
        ids.add(row.id);
        return { id: row.id, category: row.category, keywords: row.keywords };
    });
}
export function costumeImageUrl(id: string, kind: "thumbs" | "img" | "png") {
    if (!/^[A-Z]{3}-\d{4}$/.test(id)) throw new Error("服装编号无效");
    return `${COSTUME_GALLERY_URL}${kind}/${id}.${kind === "png" ? "png" : "webp"}`;
}
export function filterCostumes(rows: Costume[], category: string, query: string) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter(row => (!category || row.category === category) && terms.every(term => `${row.id} ${row.category} ${COSTUME_CATEGORIES[row.category]} ${row.keywords}`.toLowerCase().includes(words[term] || term)));
}

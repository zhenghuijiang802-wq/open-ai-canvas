import { describe, expect, test } from "bun:test";

import { groups, normalize, select } from "../src/lib/plugins/builtin/pose-gallery/core.js";

const catalogRows = [
    { prefix: "full_single", system: "全身单人・标准系" },
    { prefix: "full_sexy", system: "全身单人・性感系" },
    { prefix: "upper80v2", system: "上半身单人" },
    { prefix: "pair60", system: "双人缠绵" },
].flatMap(({ prefix, system }) => [
    { suffix: "front", angle: "正面" },
    { suffix: "side", angle: "侧面" },
].map(({ suffix, angle }) => {
    const id = `${prefix}_P001_${suffix}`;
    return {
        id,
        "体系": system,
        "姿势编号": "P001",
        "分类": "站姿",
        "姿势名称": "姿势参考",
        "角度": angle,
        "缩略图": `thumbs/${id}.jpg`,
        "原图": `img/${id}.png`,
    };
}));

describe("pose gallery catalog", () => {
    test("keeps reference images from every upstream system by default", () => {
        const rows = normalize(catalogRows);

        expect(rows.map((row) => row.id)).toEqual([
            "full_single_P001_front", "full_single_P001_side",
            "full_sexy_P001_front", "full_sexy_P001_side",
            "upper80v2_P001_front", "upper80v2_P001_side",
            "pair60_P001_front", "pair60_P001_side",
        ]);
    });

    test("keeps matching pose numbers in different systems as separate groups", () => {
        expect(groups(normalize(catalogRows)).map((variants) => variants.map((row) => row.id))).toEqual([
            ["full_single_P001_front", "full_single_P001_side"],
            ["full_sexy_P001_front", "full_sexy_P001_side"],
            ["upper80v2_P001_front", "upper80v2_P001_side"],
            ["pair60_P001_front", "pair60_P001_side"],
        ]);
    });

    test("combines a system selection with the requested viewing angle", () => {
        const result = select(normalize(catalogRows), { system: "双人缠绵", angle: "侧面" });

        expect(result.total).toBe(1);
        expect(result.rows.map((row) => row.id)).toEqual(["pair60_P001_side"]);
    });

    test("respects an explicitly configured subset of systems", () => {
        const rows = normalize(catalogRows, "https://example.com/poses/", ["全身单人・标准系"]);

        expect(rows.map((row) => row.id)).toEqual(["full_single_P001_front", "full_single_P001_side"]);
        expect(rows[0].fileUrl).toBe("https://example.com/poses/img/full_single_P001_front.png");
    });

    test("normalizes Shisei CC0 mannequin catalog format with 5 camera views", () => {
        const shiseiCatalog = [
            {
                id: "P001",
                series: "std",
                class_cn: "坐姿",
                name_cn: "后仰坐・单膝竖起",
                views: {
                    front: "std_P001_front.webp",
                    diag: "std_P001_diag.webp",
                    side: "std_P001_side.webp",
                    above: "std_P001_above.webp",
                    below: "std_P001_below.webp",
                },
            },
            {
                id: "U001",
                series: "upper",
                class_cn: "可爱系",
                name_cn: "胸前双手比心",
                views: {
                    front: "upper_U001_front.webp",
                    diag: "upper_U001_diag.webp",
                    side: null,
                },
            },
        ];

        const rows = normalize(shiseiCatalog, "https://shisei.indaloop.app/");
        expect(rows.length).toBe(7);
        expect(rows[0]).toEqual({
            id: "std_P001_front",
            title: "后仰坐・单膝竖起",
            system: "全身・标准",
            code: "P001",
            category: "坐姿",
            angle: "正面",
            group: "全身・标准 / P001",
            thumbnailUrl: "https://shisei.indaloop.app/images/line/w300/std_P001_front.webp",
            fileUrl: "https://shisei.indaloop.app/images/line/w900/std_P001_front.webp",
        });

        const stdGroups = groups(rows);
        expect(stdGroups.length).toBe(2);
        expect(stdGroups[0].map((r) => r.angle)).toEqual(["正面", "斜侧", "侧面", "俯视", "仰视"]);

        const filtered = select(rows, { system: "上半身", angle: "正面" });
        expect(filtered.total).toBe(1);
        expect(filtered.rows[0].id).toBe("upper_U001_front");
    });
});

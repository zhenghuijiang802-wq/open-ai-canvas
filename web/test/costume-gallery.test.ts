import { describe, expect, test } from "bun:test";
import { costumeImageUrl, filterCostumes, parseCostumeCatalog } from "../src/lib/costume-gallery";
const rows = [{ id: "SPR-0001", category: "春", keywords: "white denim dress" }, { id: "SUM-0001", category: "夏", keywords: "black skirt" }];
describe("costume gallery", () => {
    test("validates catalog IDs, categories and duplicate entries", () => {
        expect(parseCostumeCatalog(rows)).toEqual(rows);
        for (const invalid of [[{ ...rows[0], id: "../secret" }], [rows[0], rows[0]], [{ ...rows[0], category: "unknown" }], null]) expect(() => parseCostumeCatalog(invalid)).toThrow();
    });
    test("filters categories and multilingual search without changing catalog", () => {
        expect(filterCostumes(rows, "春", "白色 denim")).toEqual([rows[0]]);
        expect(filterCostumes(rows, "夏", "dress")).toEqual([]);
        expect(filterCostumes(rows, "", "SUM-0001")).toEqual([rows[1]]);
    });
    test("generates only fixed-origin media URLs", () => {
        expect(costumeImageUrl("SPR-0001", "png")).toBe("https://ai-costume-gallery.pages.dev/png/SPR-0001.png");
        expect(() => costumeImageUrl("https://evil.test/x", "png")).toThrow();
    });
});

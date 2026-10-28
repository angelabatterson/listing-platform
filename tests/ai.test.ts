import { describe, expect, it } from "vitest";
import { batchSku, draftSchema, draftToItem, type Draft } from "@/lib/ai/draft";
import { normalizeGroups } from "@/lib/ai/sort";
import { formatSpecifics, parseSpecifics } from "@/lib/specifics";

const draft: Draft = {
  title: "  Levi's 501   Women's Denim Jacket Size M Blue Cotton Vintage 90s Trucker Button Front Classic Fit Extra  ",
  description: "A classic denim jacket.\n\nSmall mark on the left cuff.",
  condition: "USED_GOOD",
  brand: " Levi's ",
  itemSpecifics: [
    { name: "Size", values: ["M"] },
    { name: "Color", values: ["Blue", " "] },
    { name: "Size", values: ["M", "Medium"] },
    { name: "Empty", values: [""] },
    { name: "Material", values: ["x".repeat(80)] },
  ],
  categoryQuery: " women's denim jacket ",
  suggestedPrice: 42.499,
  priceNote: "Similar jackets sell for $35 to $50.",
  whenMade: "1990s",
};

describe("sorting photos into items", () => {
  it("converts to 0-based indexes and keeps every photo exactly once", () => {
    const groups = normalizeGroups(
      [
        { photos: [3, 4], label: "Mug" },
        { photos: [1, 2, 2, 9], label: "Jacket" },
        { photos: [4, 0], label: "Repeat" },
      ],
      6,
    );
    expect(groups).toEqual([
      { photos: [0, 1], label: "Jacket" },
      { photos: [2, 3], label: "Mug" },
      { photos: [4], label: "" },
      { photos: [5], label: "" },
    ]);
  });
});

describe("turning a draft into an item", () => {
  it("tidies the title, price, brand and item specifics", () => {
    const item = draftToItem(draft);
    expect(item.title.length).toBeLessThanOrEqual(80);
    expect(item.title.startsWith("Levi's 501 Women's")).toBe(true);
    expect(item.priceCents).toBe(4250);
    expect(item.brand).toBe("Levi's");
    expect(item.attributes).toEqual({ Size: ["M", "Medium"], Color: ["Blue"], Material: ["x".repeat(65)] });
    expect(item.draftNotes).toEqual({
      categoryQuery: "women's denim jacket",
      priceNote: "Similar jackets sell for $35 to $50.",
      whenMade: "1990s",
    });
  });

  it("never prices below a dollar and drops an empty brand", () => {
    const item = draftToItem({ ...draft, suggestedPrice: 0, brand: "  " });
    expect(item.priceCents).toBe(100);
    expect(item.brand).toBeNull();
  });

  it("only accepts known conditions", () => {
    expect(draftSchema.safeParse({ ...draft, condition: "MINT" }).success).toBe(false);
  });

  it("builds SKUs from the batch and item number", () => {
    expect(batchSku(12, 0)).toBe("B12-1");
  });
});

describe("item specifics text", () => {
  it("round-trips and ignores lines without a name", () => {
    const text = "Size: M\nMaterial: Cotton, Polyester\nno colon here\n: orphan\nSize: L";
    const attrs = parseSpecifics(text);
    expect(attrs).toEqual({ Size: ["M", "L"], Material: ["Cotton", "Polyester"] });
    expect(parseSpecifics(formatSpecifics(attrs))).toEqual(attrs);
  });
});

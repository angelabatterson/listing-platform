import { describe, expect, it } from "vitest";
import { describeAspects, mergeAspects } from "@/lib/ai/aspects";
import { summarizePrices } from "@/lib/marketplaces/ebay/browse";
import { conformToAspects, missingRequiredAspects, toAspects, toCategoryOptions } from "@/lib/marketplaces/ebay/taxonomy";
import { leafCategories, rankCategories } from "@/lib/marketplaces/etsy/taxonomy";

const aspects = toAspects({
  aspects: [
    { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" } },
    {
      localizedAspectName: "Department",
      aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE" },
      aspectValues: [{ localizedValue: "Men" }, { localizedValue: "Women" }],
    },
    {
      localizedAspectName: "Features",
      aspectConstraint: { aspectUsage: "RECOMMENDED", itemToAspectCardinality: "MULTI" },
      aspectValues: [{ localizedValue: "Pockets" }],
    },
    { localizedAspectName: "Lining", aspectConstraint: { aspectUsage: "OPTIONAL" } },
  ],
});

describe("eBay categories and item specifics", () => {
  it("builds readable category paths", () => {
    expect(
      toCategoryOptions({
        categorySuggestions: [
          {
            category: { categoryId: "57988", categoryName: "Coats" },
            categoryTreeNodeAncestors: [
              { categoryName: "Men", categoryTreeNodeLevel: 2 },
              { categoryName: "Clothing", categoryTreeNodeLevel: 1 },
            ],
          },
        ],
      }),
    ).toEqual([{ id: "57988", name: "Coats", path: "Clothing > Men > Coats" }]);
  });

  it("finds required specifics that are missing, counting the brand field", () => {
    expect(missingRequiredAspects(aspects, { department: ["Men"] }, null)).toEqual(["Brand"]);
    expect(missingRequiredAspects(aspects, {}, "Levi's")).toEqual(["Department"]);
  });

  it("keeps only values eBay accepts", () => {
    expect(
      conformToAspects({ department: ["women", "men"], Features: ["Pockets", "Hood"], Color: ["Blue"] }, aspects),
    ).toEqual({ Department: ["Women"], Features: ["Pockets", "Hood"], Color: ["Blue"] });
    expect(conformToAspects({ Department: ["Kids"] }, aspects)).toEqual({});
  });

  it("asks the AI only for wanted specifics the item doesn't have", () => {
    const text = describeAspects(aspects, { Brand: ["Levi's"] });
    expect(text).toContain("- Department (required, one value; allowed values: Men | Women)");
    expect(text).toContain("- Features (recommended, several values allowed");
    expect(text).not.toContain("Brand");
    expect(text).not.toContain("Lining");
  });

  it("never lets the AI overwrite the seller's values", () => {
    expect(
      mergeAspects({ Size: ["M"] }, { aspects: [{ name: "size", values: ["L"] }, { name: "Color", values: ["Unknown", "Blue"] }] }),
    ).toEqual({ Size: ["M"], Color: ["Blue"] });
  });
});

describe("eBay price check", () => {
  it("summarises the middle of the asking prices", () => {
    const summary = summarizePrices({
      itemSummaries: [10, 20, 30, 40, 50].map((p) => ({
        title: `Jacket ${p}`,
        price: { value: String(p), currency: "USD" },
        itemWebUrl: `https://ebay.example/${p}`,
      })),
    });
    expect(summary).toMatchObject({ count: 5, lowCents: 2000, medianCents: 3000, highCents: 4000 });
    expect(summarizePrices({ itemSummaries: [] })).toBeNull();
  });
});

describe("Etsy categories", () => {
  const leaves = leafCategories([
    {
      id: 1,
      name: "Clothing",
      children: [
        { id: 11, name: "Jackets & Coats" },
        { id: 12, name: "Dresses" },
      ],
    },
    { id: 2, name: "Home & Living", children: [{ id: 21, name: "Coffee Mugs" }] },
  ]);

  it("flattens the tree to leaves with paths", () => {
    expect(leaves).toEqual([
      { id: "11", name: "Jackets & Coats", path: "Clothing > Jackets & Coats" },
      { id: "12", name: "Dresses", path: "Clothing > Dresses" },
      { id: "21", name: "Coffee Mugs", path: "Home & Living > Coffee Mugs" },
    ]);
  });

  it("ranks leaves by matching words", () => {
    expect(rankCategories(leaves, "vintage denim jacket").map((l) => l.id)).toEqual(["11"]);
    expect(rankCategories(leaves, "clothing dresses")[0].id).toBe("12");
    expect(rankCategories(leaves, "xy")).toEqual([]);
  });
});

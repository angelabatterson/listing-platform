import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";
import { postingProblems, type ItemForReview } from "@/lib/review";
import { makeConnection, makeItem, makeListing } from "./fixtures";

function draft(listings: ItemForReview["listings"], overrides: Partial<ItemForReview> = {}): ItemForReview {
  return { ...makeItem({ status: "draft" }), listings, ...overrides };
}

describe("checking a draft before posting", () => {
  const ebay = makeConnection();

  it("passes a complete draft", () => {
    expect(postingProblems(draft([{ ...makeListing(), connection: ebay }]))).toEqual([]);
  });

  it("needs at least one ticked store and some stock", () => {
    expect(postingProblems(draft([{ ...makeListing({ enabled: false }), connection: ebay }]))).toEqual([
      "Tick at least one store on the item page.",
    ]);
    expect(postingProblems(draft([{ ...makeListing(), connection: ebay }], { quantity: 0 }))).toEqual([
      "Set the quantity to at least 1.",
    ]);
  });

  it("names the store for each problem", () => {
    const noCategory = { ...makeListing({ overrides: {} }), connection: ebay };
    expect(postingProblems(draft([noCategory]))).toEqual(["eBay: Choose an eBay category for this item."]);
    const unready = { ...makeListing(), connection: makeConnection({ settings: {} }) };
    expect(postingProblems(draft([unready]))).toEqual(["eBay: finish this store's setup on the Stores page."]);
  });
});

describe("CSV export", () => {
  it("quotes cells that need it", () => {
    expect(csvCell('He said "hi", then left\nagain')).toBe('"He said ""hi"", then left\nagain"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("stops spreadsheets running cells as formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@sum")).toBe("'@sum");
  });

  it("joins rows with CRLF", () => {
    expect(toCsv([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2\r\n");
  });
});

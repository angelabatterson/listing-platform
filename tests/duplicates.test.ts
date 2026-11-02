import { describe, expect, it } from "vitest";
import { matchDuplicates, skuKey, titleLikeness, titleWords } from "@/lib/duplicates";

const item = (id: string, title: string, sku = id, photos: string[] = []) => ({ id, title, sku, photos });

describe("the duplicate check", () => {
  it("reads titles and SKUs the way a person would", () => {
    expect(titleWords("Levi's 501 Jeans, Size 32 - NWT")).toEqual(["levis", "501", "jeans", "32"]);
    expect(skuKey("JLTBD-02")).toBe(skuKey("jltbd_2"));
    expect(skuKey("A-12")).not.toBe(skuKey("A-1-2"));
    expect(titleLikeness(["a1", "b1", "c1", "d1"], ["a1", "b1", "c1", "d1", "e1"])).toBe(0.8);
  });

  it("pairs near-identical titles, matching SKUs and shared photos, and leaves different items alone", () => {
    const found = matchDuplicates([
      item("1", "Vintage Levi's 501 Denim Jeans Blue 32x30"),
      item("2", "Vintage Levis 501 denim jeans blue 32x30 USA"),
      item("3", "Pendleton wool shirt plaid large"),
      item("4", "Something else", "JL-02"),
      item("5", "Totally different", "jl_2"),
      item("6", "Red mug", "M1", ["https://img/a.jpg"]),
      item("7", "Coffee cup", "M2", ["https://img/a.jpg"]),
      item("8", "Vintage Levi's 505 corduroy pants brown"),
    ]);
    expect(found.get("1")).toMatchObject({ otherId: "2", reason: "title" });
    expect(found.get("2")).toMatchObject({ otherId: "1" });
    expect(found.get("4")).toMatchObject({ otherId: "5", reason: "sku" });
    expect(found.get("6")).toMatchObject({ otherId: "7", reason: "photo" });
    expect(found.has("3")).toBe(false);
    expect(found.has("8")).toBe(false);
  });
});

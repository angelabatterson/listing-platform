import { describe, expect, it } from "vitest";
import { toInventoryItem } from "@/lib/marketplaces/ebay/mapping";
import { forStore } from "@/lib/marketplaces/overrides";
import { makeItem, makeListing } from "./fixtures";

describe("a store's own version of an item", () => {
  it("is the main item when the store changes nothing", () => {
    const item = makeItem();
    expect(forStore(item, makeListing({ overrides: {} }))).toEqual(item);
  });

  it("lays the store's title, description, condition and price over the item", () => {
    const view = forStore(
      makeItem(),
      makeListing({ overrides: { title: "Levi's trucker jacket", description: "For Depop", condition: "USED_EXCELLENT", priceCents: 3000 } }),
    );
    expect(view).toMatchObject({ title: "Levi's trucker jacket", description: "For Depop", condition: "USED_EXCELLENT", priceCents: 3000 });
  });

  it("uses only the chosen photos, in the chosen order", () => {
    const view = forStore(makeItem(), makeListing({ overrides: { imageUrls: ["https://img.example/2.jpg"] } }));
    expect(view.images.map((i) => [i.url, i.position])).toEqual([["https://img.example/2.jpg", 0]]);
    expect(toInventoryItem(view, makeListing()).product.imageUrls).toEqual(["https://img.example/2.jpg"]);
  });

  it("falls back to every photo when the chosen ones were removed from the item", () => {
    const item = makeItem();
    const view = forStore(item, makeListing({ overrides: { imageUrls: ["https://img.example/gone.jpg"] } }));
    expect(view.images).toEqual(item.images);
  });
});

import { describe, expect, it } from "vitest";
import { hasSold, stillUp, stillUpMessage, storesStillUp } from "@/lib/item-delete";

const l = (status: "not_listed" | "listed" | "ended" | "error" | "waiting", extra: { remoteListingId?: string; remoteUrl?: string } = {}) => ({
  status,
  remoteListingId: extra.remoteListingId ?? null,
  remoteUrl: extra.remoteUrl ?? null,
});

describe("deleting items", () => {
  it("treats sold-out items and items with any sale as sold", () => {
    expect(hasSold({ status: "sold_out" }, 0)).toBe(true);
    expect(hasSold({ status: "active" }, 1)).toBe(true);
    expect(hasSold({ status: "draft" }, 0)).toBe(false);
  });

  it("knows when a listing may still be up", () => {
    expect(stillUp(l("listed"))).toBe(true);
    expect(stillUp(l("error", { remoteListingId: "1" }))).toBe(true);
    expect(stillUp(l("waiting", { remoteUrl: "https://poshmark.com/x" }))).toBe(true);
    expect(stillUp(l("waiting"))).toBe(false); // queued to post, never posted
    expect(stillUp(l("error"))).toBe(false);
    expect(stillUp(l("ended", { remoteListingId: "1" }))).toBe(false);
  });

  it("names each store it's still up on", () => {
    const stores = storesStillUp([
      { ...l("listed"), connection: { marketplace: "ebay" } },
      { ...l("listed"), connection: { marketplace: "ebay" } },
      { ...l("waiting", { remoteUrl: "u" }), connection: { marketplace: "poshmark" } },
      { ...l("ended"), connection: { marketplace: "etsy" } },
    ]);
    expect(stores).toEqual(["eBay", "Poshmark"]);
    expect(stillUpMessage(stores)).toBe("It's still up on eBay and Poshmark. Take it down there first (Delist), then delete it.");
    expect(stillUpMessage(["eBay", "Etsy", "Depop"])).toContain("eBay, Etsy and Depop");
  });
});

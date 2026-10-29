import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channelListings, connections, items, organizations } from "@/db/schema";
import { allTags, filterHref, listInventory, parseFilters, viewCounts } from "@/lib/inventory";
import { parseTags } from "@/lib/tags";

describe("inventory filters in the address", () => {
  it("reads known filters and ignores the rest", () => {
    const f = parseFilters({ view: "sold", q: " jacket ", store: "nope", issue: "error", sort: "bogus", page: "3", tag: "Bin 4" });
    expect(f).toEqual({ view: "sold", q: "jacket", store: "", issue: "error", tag: "Bin 4", sort: "updated", page: 3 });
    expect(parseFilters({})).toMatchObject({ view: "all", sort: "updated", page: 1 });
  });

  it("writes only what differs from the defaults, and goes back to page 1 on change", () => {
    const f = parseFilters({ view: "drafts", page: "2" });
    expect(filterHref(f, { tag: "Bin 4" })).toBe("/items?view=drafts&tag=Bin+4");
    expect(filterHref(f, { page: 3 })).toBe("/items?view=drafts&page=3");
    expect(filterHref(parseFilters({}))).toBe("/items");
  });

  it("cleans up typed tags", () => {
    expect(parseTags("Bin 4,  women's   denim , bin 4,, ")).toEqual(["Bin 4", "women's denim"]);
  });
});

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("listing inventory", () => {
  let org: string;
  let ebay: string;

  beforeEach(async () => {
    await db.delete(organizations);
    const [o] = await db.insert(organizations).values({ name: "Mine" }).returning();
    org = o.id;
    const [c] = await db
      .insert(connections)
      .values({ organizationId: org, marketplace: "poshmark", environment: "production" })
      .returning();
    ebay = c.id;
    const made = await db
      .insert(items)
      .values([
        { organizationId: org, sku: "A-1", title: "Denim jacket", priceCents: 4500, status: "active", tags: ["Bin 4", "Denim"] },
        { organizationId: org, sku: "A-2", title: "Wool coat", priceCents: 9000, status: "active", tags: ["Bin 5"] },
        { organizationId: org, sku: "A-3", title: "Denim skirt 100%", priceCents: 2000, status: "draft", tags: ["Denim"] },
        { organizationId: org, sku: "A-4", title: "Silk scarf", priceCents: 1500, status: "sold_out" },
        { organizationId: org, sku: "A-5", title: "Old hat", priceCents: 500, status: "archived" },
      ])
      .returning();
    await db.insert(channelListings).values([
      { itemId: made[0].id, connectionId: ebay, enabled: true, status: "listed" },
      { itemId: made[1].id, connectionId: ebay, enabled: true, status: "error" },
    ]);
    // Someone else's item never shows up.
    const [other] = await db.insert(organizations).values({ name: "Theirs" }).returning();
    await db.insert(items).values({ organizationId: other.id, sku: "A-1", title: "Denim jeans", priceCents: 100, tags: ["Secret"] });
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const titles = async (params: Record<string, string>) =>
    (await listInventory(org, parseFilters(params))).rows.map((r) => r.title);

  it("splits items into tabs and counts each one under the other filters", async () => {
    expect(await viewCounts(org, parseFilters({}))).toEqual({ all: 4, listed: 2, drafts: 1, sold: 1, archived: 1 });
    expect(await viewCounts(org, parseFilters({ q: "denim" }))).toEqual({ all: 2, listed: 1, drafts: 1, sold: 0, archived: 0 });
    expect(await titles({ view: "archived" })).toEqual(["Old hat"]);
  });

  it("searches, filters by store, problem and tag, and sorts", async () => {
    expect(await titles({ q: "denim", sort: "title" })).toEqual(["Denim jacket", "Denim skirt 100%"]);
    expect(await titles({ q: "100%" })).toEqual(["Denim skirt 100%"]);
    expect(await titles({ q: "a-4" })).toEqual(["Silk scarf"]);
    expect(await titles({ store: ebay, sort: "price-low" })).toEqual(["Denim jacket", "Wool coat"]);
    expect(await titles({ issue: "error" })).toEqual(["Wool coat"]);
    expect(await titles({ issue: "unlisted" })).toEqual(["Wool coat"]);
    expect(await titles({ tag: "Denim", sort: "price-high" })).toEqual(["Denim jacket", "Denim skirt 100%"]);
    expect(await allTags(org)).toEqual(["Bin 4", "Bin 5", "Denim"]);
  });
});

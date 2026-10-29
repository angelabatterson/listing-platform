import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { buyerNotes, connections, items, organizations, sales } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { buyers, rangeBounds, salesByMonth, salesByStore, salesTotals, staleItems } from "@/lib/dashboard";

const user = { id: "", organizationId: "", email: "seller@example.com", name: null as string | null };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireUser: async () => user,
}));
const { saveBuyerNote } = await import("@/app/(app)/buyers/actions");

const now = new Date("2026-10-20T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("rangeBounds", () => {
  it("uses calendar months in UTC", () => {
    expect(rangeBounds("month", now)).toEqual({ from: new Date("2026-10-01T00:00:00Z"), to: null });
    expect(rangeBounds("last-month", now)).toEqual({
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
    });
    expect(rangeBounds("year", now).from).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(rangeBounds("all", now)).toEqual({ from: null, to: null });
  });
});

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("seller dashboard", () => {
  let org: string;
  let otherOrg: string;

  beforeEach(async () => {
    await db.delete(organizations);
    const [o, other] = await db.insert(organizations).values([{ name: "Mine" }, { name: "Theirs" }]).returning();
    org = o.id;
    otherOrg = other.id;
    user.organizationId = org;
    const token = { accessTokenEnc: encrypt("t"), accessTokenExpiresAt: daysAgo(-1), environment: "sandbox" };
    const [ebay, etsy, theirEbay] = await db
      .insert(connections)
      .values([
        { ...token, organizationId: org, marketplace: "ebay" },
        { ...token, organizationId: org, marketplace: "etsy" },
        { ...token, organizationId: otherOrg, marketplace: "ebay" },
      ])
      .returning();
    const [jacket, mug, old] = await db
      .insert(items)
      .values([
        { organizationId: org, sku: "J", title: "Jacket", priceCents: 6000, costCents: 1000, quantity: 0, status: "sold_out" },
        { organizationId: org, sku: "M", title: "Mug", priceCents: 1250, quantity: 3, status: "active" },
        { organizationId: org, sku: "OLD", title: "Old lamp", priceCents: 4000, costCents: 500, quantity: 1, status: "active", createdAt: daysAgo(90) },
      ])
      .returning();
    void old;
    const sale = { externalOrderId: "", externalLineId: "", quantity: 1 };
    await db.insert(sales).values([
      // Two eBay orders from the same buyer: a repeat buyer.
      { ...sale, organizationId: org, connectionId: ebay.id, itemId: jacket.id, externalOrderId: "E1", externalLineId: "E1-1", soldAt: daysAgo(5), priceCents: 5500, shippingCents: 850, feesCents: 700, buyerId: "pyrexfan", buyerName: "Pat" },
      { ...sale, organizationId: org, connectionId: ebay.id, itemId: mug.id, externalOrderId: "E2", externalLineId: "E2-1", soldAt: daysAgo(40), priceCents: 1250, feesCents: 160, buyerId: "pyrexfan", buyerName: "Pat" },
      // Etsy: two mugs, no cost entered, estimated fees.
      { ...sale, organizationId: org, connectionId: etsy.id, itemId: mug.id, externalOrderId: "T1", externalLineId: "T1-1", quantity: 2, soldAt: daysAgo(2), priceCents: 2500, shippingCents: 500, feesCents: 330, feesEstimated: true, buyerId: "4242", buyerName: "Sam" },
      // Another account's sale never shows up.
      { ...sale, organizationId: otherOrg, connectionId: theirEbay.id, externalOrderId: "X", externalLineId: "X-1", soldAt: daysAgo(1), priceCents: 99_999, buyerId: "pyrexfan" },
    ]);
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  it("adds up sales, fees, cost and profit for a period", async () => {
    const last30 = await salesTotals(org, daysAgo(30), null);
    expect(last30).toMatchObject({
      lines: 2,
      units: 3,
      sales: 8000,
      shipping: 1350,
      fees: 1030,
      cost: 1000,
      profit: 8000 - 1030 - 1000,
      uncosted: 1,
      estimatedFees: 1,
    });
    expect((await salesTotals(org, null, null)).sales).toBe(9250);
  });

  it("splits by store and by month", async () => {
    const stores = await salesByStore(org, null, null);
    expect(stores.map((s) => [s.marketplace, s.units, s.sales, s.profit])).toEqual([
      ["ebay", 2, 6750, 6750 - 860 - 1000],
      ["etsy", 2, 2500, 2500 - 330],
    ]);
    const months = await salesByMonth(org, now);
    expect(months).toHaveLength(12);
    expect(months[0].month).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(months[0].totals?.sales).toBe(8000);
    expect(months[1].totals?.sales).toBe(1250);
    expect(months[2].totals).toBeNull();
  });

  it("lists items sitting unsold and buyers by spend", async () => {
    expect((await staleItems(org, now)).map((i) => [i.title, i.days])).toEqual([["Old lamp", 90]]);
    const list = await buyers(org);
    expect(list.map((b) => [b.marketplace, b.buyerId, b.orders, b.spent])).toEqual([
      ["ebay", "pyrexfan", 2, 5500 + 850 + 1250],
      ["etsy", "4242", 1, 3000],
    ]);
  });

  it("saves one note per buyer", async () => {
    const form = (note: string) => {
      const f = new FormData();
      f.set("marketplace", "ebay");
      f.set("buyerId", "pyrexfan");
      f.set("note", note);
      return f;
    };
    await saveBuyerNote(form("Collects Pyrex"));
    await saveBuyerNote(form("Collects Pyrex and Fire-King"));
    const notes = await db.query.buyerNotes.findMany();
    expect(notes.map((n) => [n.organizationId, n.note])).toEqual([[org, "Collects Pyrex and Fire-King"]]);
    await db.delete(buyerNotes);
  });
});

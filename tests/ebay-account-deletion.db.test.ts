import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { buyerNotes, connections, organizations, sales } from "@/db/schema";
import { forgetEbayUser } from "@/lib/marketplaces/ebay/account-deletion";

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("forgetting a closed eBay account", () => {
  let ids: { org: string; ebay: string; etsy: string };

  beforeEach(async () => {
    await db.delete(organizations);
    const [org] = await db.insert(organizations).values({ name: "Test" }).returning();
    const [ebay] = await db
      .insert(connections)
      .values({ organizationId: org.id, marketplace: "ebay", environment: "sandbox", externalAccountId: "seller-1" })
      .returning();
    const [etsy] = await db
      .insert(connections)
      .values({ organizationId: org.id, marketplace: "etsy", environment: "production" })
      .returning();
    const line = { organizationId: org.id, quantity: 1, soldAt: new Date(), externalOrderId: "o1" };
    await db.insert(sales).values([
      { ...line, connectionId: ebay.id, externalLineId: "l1", buyerId: "buyer1", buyerName: "Pat Buyer" },
      { ...line, connectionId: ebay.id, externalLineId: "l2", buyerId: "someone", buyerName: "Other" },
      { ...line, connectionId: etsy.id, externalLineId: "l3", buyerId: "buyer1", buyerName: "Etsy Buyer" },
    ]);
    await db.insert(buyerNotes).values([
      { organizationId: org.id, marketplace: "ebay", buyerId: "buyer1", note: "Repeat buyer" },
      { organizationId: org.id, marketplace: "etsy", buyerId: "buyer1", note: "Etsy note" },
    ]);
    ids = { org: org.id, ebay: ebay.id, etsy: etsy.id };
  });

  it("clears the buyer from eBay sales and notes only", async () => {
    await forgetEbayUser({ username: "buyer1", userId: "buyer-id" });
    const rows = await db.select().from(sales).where(eq(sales.organizationId, ids.org));
    const byLine = Object.fromEntries(rows.map((r) => [r.externalLineId, r]));
    expect(byLine.l1).toMatchObject({ buyerId: null, buyerName: null });
    expect(byLine.l2).toMatchObject({ buyerId: "someone" });
    expect(byLine.l3).toMatchObject({ buyerId: "buyer1", buyerName: "Etsy Buyer" });
    const notes = await db.select().from(buyerNotes);
    expect(notes.map((n) => n.marketplace)).toEqual(["etsy"]);
    expect(await db.select().from(connections)).toHaveLength(2);
  });

  it("removes the store link when the closed account was the seller", async () => {
    await forgetEbayUser({ username: "the-seller", userId: "seller-1" });
    const left = await db.select().from(connections);
    expect(left.map((c) => c.marketplace)).toEqual(["etsy"]);
  });
});

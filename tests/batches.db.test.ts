import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { batches, channelListings, connections, itemImages, items, organizations, photos } from "@/db/schema";
import { encrypt } from "@/lib/crypto";

const user = { id: "", organizationId: "", email: "a@b.c" };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const askForJson = vi.fn();
vi.mock("@/lib/ai/client", async (original) => ({
  ...(await original<typeof import("@/lib/ai/client")>()),
  askForJson: (...args: unknown[]) => askForJson(...args),
}));

const { discardDraft, draftItem, sortPhotos } = await import("@/app/(app)/batches/actions");

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("drafting listings from a photo batch", () => {
  let batchId: string;
  let ebayId: string;

  beforeEach(async () => {
    await db.delete(organizations);
    askForJson.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        const body = url.pathname.endsWith("get_default_category_tree_id")
          ? { categoryTreeId: "0" }
          : url.pathname.endsWith("get_category_suggestions")
            ? {
                categorySuggestions: [
                  {
                    category: { categoryId: "57988", categoryName: "Coats, Jackets & Vests" },
                    categoryTreeNodeAncestors: [{ categoryName: "Clothing", categoryTreeNodeLevel: 1 }],
                  },
                ],
              }
            : {
                aspects: [
                  { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true } },
                  {
                    localizedAspectName: "Department",
                    aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" },
                    aspectValues: [{ localizedValue: "Men" }, { localizedValue: "Women" }],
                  },
                ],
              };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const [org] = await db.insert(organizations).values({ name: "Test" }).returning();
    user.organizationId = org.id;
    const [ebay] = await db
      .insert(connections)
      .values({
        organizationId: org.id,
        marketplace: "ebay",
        environment: "sandbox",
        accessTokenEnc: encrypt("t"),
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        settings: { merchantLocationKey: "default", fulfillmentPolicyId: "f", paymentPolicyId: "p", returnPolicyId: "r" },
      })
      .returning();
    ebayId = ebay.id;
    const [batch] = await db.insert(batches).values({ organizationId: org.id, number: 7 }).returning();
    batchId = batch.id;
    await db.insert(photos).values(
      [0, 1, 2].map((position) => ({ organizationId: org.id, batchId, position, data: jpeg, thumb: jpeg })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  it("sorts photos, drafts one item per group, and can start an item over", async () => {
    askForJson.mockResolvedValueOnce({ items: [{ photos: [1, 2], label: "Jacket" }, { photos: [3], label: "Mug" }] });
    expect(await sortPhotos(batchId)).toEqual({});
    const sorted = await db.select().from(photos).where(eq(photos.batchId, batchId)).orderBy(photos.position);
    expect(sorted.map((p) => p.groupKey)).toEqual([0, 0, 1]);

    askForJson.mockResolvedValueOnce({
      title: "Levi's denim jacket",
      description: "Blue denim jacket.",
      condition: "USED_EXCELLENT",
      brand: "Levi's",
      itemSpecifics: [{ name: "Size", values: ["M"] }],
      categoryQuery: "denim jacket",
      suggestedPrice: 45,
      priceNote: "Typical for this jacket.",
      whenMade: "2010_2019",
    });
    askForJson.mockResolvedValueOnce({ aspects: [{ name: "Department", values: ["women"] }] });
    const result = await draftItem(batchId, 0);
    expect(result.error).toBeUndefined();

    const item = await db.query.items.findFirst({
      where: eq(items.id, result.itemId!),
      with: { images: true, listings: true },
    });
    // eBay's top category was picked and its required specifics filled in.
    expect(item).toMatchObject({
      sku: "B7-1",
      status: "draft",
      priceCents: 4500,
      attributes: { Size: ["M"], Brand: ["Levi's"], Department: ["Women"] },
    });
    expect(item!.images.map((i) => i.url)).toEqual(
      sorted.slice(0, 2).map((p) => expect.stringContaining(`/api/photos/${p.id}-`)),
    );
    expect(item!.listings).toMatchObject([
      { connectionId: ebayId, enabled: true, status: "not_listed", overrides: { categoryId: "57988" } },
    ]);
    // The AI saw both photos of the jacket.
    expect(askForJson.mock.calls[1][0].content.filter((b: { type: string }) => b.type === "image")).toHaveLength(2);

    expect(await draftItem(batchId, 0)).toEqual({ error: "Those photos have already been drafted." });

    await discardDraft(item!.id);
    expect(await db.query.items.findFirst({ where: eq(items.id, item!.id) })).toBeUndefined();
    expect(await db.select().from(itemImages)).toHaveLength(0);
    const back = await db.select().from(photos).where(eq(photos.batchId, batchId)).orderBy(photos.position);
    expect(back.map((p) => [p.groupKey, p.itemId])).toEqual([[0, null], [0, null], [1, null]]);
  });

  it("reports an AI failure without creating an item", async () => {
    await db.update(photos).set({ groupKey: 0 }).where(eq(photos.batchId, batchId));
    const { AiError } = await import("@/lib/ai/client");
    askForJson.mockRejectedValueOnce(new AiError("The AI declined to describe these photos. Fill this one in by hand."));
    expect(await draftItem(batchId, 0)).toEqual({
      error: "The AI declined to describe these photos. Fill this one in by hand.",
    });
    expect(await db.select().from(items)).toHaveLength(0);
    expect(await db.select().from(channelListings)).toHaveLength(0);
  });
});

"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { channelListings, connections, items, type ListingOverrides } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { writeProblem } from "@/lib/billing/access";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { isExtensionMarketplace } from "@/lib/marketplaces/labels";
import { forStore } from "@/lib/marketplaces/overrides";
import { isConnectionReady, storeLabel } from "@/lib/stores";
import { syncItem } from "@/lib/sync/run";

// The "List on [store]" pop-up on the Inventory page: one store's own version of an item.

export type StoreListingData = {
  store: { label: string; marketplace: string; extension: boolean; ready: boolean };
  item: { status: string; photos: string[] };
  // What the store shows now: the main item with this store's changes laid over it.
  view: { title: string; description: string; price: string; condition: string; photos: string[] };
  categoryId: string;
  whenMade: string;
  listingStatus: string;
  lastError: string | null;
};

async function load(organizationId: string, itemId: string, connectionId: string) {
  const [item, connection] = await Promise.all([
    db.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.organizationId, organizationId)),
      with: { images: true, listings: true },
    }),
    db.query.connections.findFirst({
      where: and(eq(connections.id, connectionId), eq(connections.organizationId, organizationId)),
    }),
  ]);
  if (!item || !connection) return null;
  return { item, connection, listing: item.listings.find((l) => l.connectionId === connectionId) };
}

export async function loadStoreListing(itemId: string, connectionId: string): Promise<StoreListingData | null> {
  const user = await requireUser();
  const found = await load(user.organizationId, itemId, connectionId);
  if (!found) return null;
  const { item, connection, listing } = found;
  const view = forStore(item, { overrides: listing?.overrides ?? {} });
  const sorted = (imgs: typeof item.images) => [...imgs].sort((a, b) => a.position - b.position).map((i) => i.url);
  return {
    store: {
      label: storeLabel(connection),
      marketplace: connection.marketplace,
      extension: isExtensionMarketplace(connection.marketplace),
      ready: isConnectionReady(connection),
    },
    item: { status: item.status, photos: sorted(item.images) },
    view: {
      title: view.title,
      description: view.description,
      price: (view.priceCents / 100).toFixed(2),
      condition: view.condition,
      photos: sorted(view.images),
    },
    categoryId: listing?.overrides.categoryId ?? "",
    whenMade: listing?.overrides.whenMade ?? "",
    listingStatus: listing?.status ?? "not_listed",
    lastError: listing?.lastError ?? null,
  };
}

export type StoreListingState = { error?: string; message?: string; ok?: boolean } | undefined;

const schema = z.object({
  title: z.string().trim().min(1, "Give the listing a title."),
  description: z.string().trim(),
  price: z.string().refine((v) => Number(v) > 0, "Enter a price above zero."),
  condition: z.string().min(1),
  categoryId: z.string().trim().default(""),
  whenMade: z.string().default(""),
});

export async function saveStoreListing(
  itemId: string,
  connectionId: string,
  _prev: StoreListingState,
  formData: FormData,
): Promise<StoreListingState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    ...Object.fromEntries(formData),
    categoryId: formData.get(`category_${connectionId}`) ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const blocked = await writeProblem(user);
  if (blocked) return { error: blocked };
  const found = await load(user.organizationId, itemId, connectionId);
  if (!found) return { error: "Item or store not found." };
  const { item, connection, listing } = found;
  const d = parsed.data;

  const allPhotos = [...item.images].sort((a, b) => a.position - b.position).map((i) => i.url);
  const photos = formData.getAll("photo").map(String).filter((u) => allPhotos.includes(u));
  if (allPhotos.length && photos.length === 0) return { error: "Pick at least one photo." };
  const priceCents = Math.round(Number(d.price) * 100);

  // Only what differs from the main item is kept, so later edits to the item still flow through.
  const overrides: ListingOverrides = {
    ...listing?.overrides,
    title: d.title !== item.title ? d.title : undefined,
    description: d.description !== item.description.trim() ? d.description : undefined,
    condition: d.condition !== item.condition ? d.condition : undefined,
    priceCents: priceCents !== item.priceCents ? priceCents : undefined,
    imageUrls: photos.join("\n") !== allPhotos.join("\n") ? photos : undefined,
    categoryId: d.categoryId || undefined,
    whenMade: d.whenMade || undefined,
  };

  await db
    .insert(channelListings)
    .values({ itemId: item.id, connectionId: connection.id, enabled: true, overrides })
    .onConflictDoUpdate({
      target: [channelListings.itemId, channelListings.connectionId],
      set: { enabled: true, overrides },
    });
  revalidatePath("/items");
  revalidatePath(`/items/${item.id}`);

  const store = MARKETPLACE_LABELS[connection.marketplace];
  if (item.status !== "active") {
    return { ok: true, message: `Saved. This item is a ${item.status === "draft" ? "Draft" : item.status.replace("_", " ")}, so it goes on ${store} once you set it to Active.` };
  }
  if (item.quantity < 1) return { ok: true, message: `Saved. It goes on ${store} once the quantity is above 0.` };
  const [outcome] = await syncItem(user.organizationId, item.id, { only: connection.id });
  if (!outcome) return { ok: true, message: "Saved. Nothing needed to change." };
  if (!outcome.ok) return { error: outcome.message?.replace(`${store}: `, "") ?? `${store} didn't accept it.` };
  return { ok: true, message: outcome.message ?? "Saved." };
}

// Take the item off one store and stop listing it there.
export async function removeFromStore(itemId: string, connectionId: string): Promise<StoreListingState> {
  const user = await requireUser();
  const found = await load(user.organizationId, itemId, connectionId);
  if (!found?.listing) return { error: "Item or store not found." };
  await db.update(channelListings).set({ enabled: false }).where(eq(channelListings.id, found.listing.id));
  const [outcome] = await syncItem(user.organizationId, itemId, { only: connectionId });
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  if (outcome && !outcome.ok) return { error: outcome.message };
  return { ok: true, message: "Taken off this store." };
}

"use server";

import { and, asc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { channelListings, connections, items } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { syncItem } from "@/lib/sync/run";

// Quick edits and fixes straight from the Inventory list.

export type InventoryResult = { error?: string; message?: string };

const id = z.uuid();

async function ownItem(organizationId: string, itemId: string) {
  if (!id.safeParse(itemId).success) return null;
  return db.query.items.findFirst({
    where: and(eq(items.id, itemId), eq(items.organizationId, organizationId)),
    columns: { id: true },
  });
}

export async function setFavorite(itemId: string, favorite: boolean): Promise<InventoryResult> {
  const user = await requireUser();
  if (!(await ownItem(user.organizationId, itemId))) return { error: "Item not found." };
  await db.update(items).set({ favorite }).where(eq(items.id, itemId));
  revalidatePath("/items");
  return {};
}

const quickSchema = z.object({
  notes: z.string().max(500, "Notes can be at most 500 characters.").optional(),
  cost: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), "Enter what you paid, like 4.50.")
    .optional(),
});

// Private notes and cost of goods, typed into the row.
export async function saveRowDetails(itemId: string, fields: { notes?: string; cost?: string }): Promise<InventoryResult> {
  const user = await requireUser();
  const parsed = quickSchema.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await ownItem(user.organizationId, itemId))) return { error: "Item not found." };
  const { notes, cost } = parsed.data;
  await db
    .update(items)
    .set({
      ...(notes !== undefined ? { notes: notes.trim() } : {}),
      ...(cost !== undefined ? { costCents: cost === "" ? null : Math.round(Number(cost) * 100) } : {}),
    })
    .where(eq(items.id, itemId));
  revalidatePath("/items");
  return {};
}

// How many failed listings one click tries again, so the page doesn't time out.
const RETRY_BATCH = 20;

async function failedListings(organizationId: string) {
  return db
    .select({ id: channelListings.id, itemId: channelListings.itemId, connectionId: channelListings.connectionId, remoteListingId: channelListings.remoteListingId })
    .from(channelListings)
    .innerJoin(items, eq(items.id, channelListings.itemId))
    .where(and(eq(items.organizationId, organizationId), eq(channelListings.status, "error")));
}

// Try every failed listing again (up to RETRY_BATCH at a time).
export async function retryFailed(): Promise<InventoryResult> {
  const user = await requireUser();
  const failed = await failedListings(user.organizationId);
  let fixed = 0;
  for (const l of failed.slice(0, RETRY_BATCH)) {
    const [outcome] = await syncItem(user.organizationId, l.itemId, { only: l.connectionId }).catch(() => []);
    if (outcome?.ok) fixed++;
  }
  revalidatePath("/items");
  const tried = Math.min(failed.length, RETRY_BATCH);
  const left = failed.length - tried;
  return {
    message: `${fixed} of ${tried} ${tried === 1 ? "listing" : "listings"} went through.${left ? ` ${left} more to retry.` : ""}`,
  };
}

// Give up on failed listings: ones that never went up are unticked for that store;
// ones already live keep their listing and just lose the error.
export async function discardFailed(): Promise<InventoryResult> {
  const user = await requireUser();
  const failed = await failedListings(user.organizationId);
  const neverUp = failed.filter((l) => !l.remoteListingId).map((l) => l.id);
  const live = failed.filter((l) => l.remoteListingId).map((l) => l.id);
  await db.transaction(async (tx) => {
    if (neverUp.length) {
      await tx
        .update(channelListings)
        .set({ enabled: false, status: "not_listed", lastError: null })
        .where(inArray(channelListings.id, neverUp));
    }
    if (live.length) {
      await tx.update(channelListings).set({ status: "listed", lastError: null }).where(inArray(channelListings.id, live));
    }
  });
  revalidatePath("/items");
  return { message: `Cleared ${failed.length} ${failed.length === 1 ? "problem" : "problems"}.` };
}

// Items to move a store listing to, for the store menu's search box.
export async function findItems(query: string, excludeItemId: string): Promise<{ id: string; title: string; sku: string }[]> {
  const user = await requireUser();
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select({ id: items.id, title: items.title, sku: items.sku })
    .from(items)
    .where(
      and(
        eq(items.organizationId, user.organizationId),
        ne(items.status, "archived"),
        id.safeParse(excludeItemId).success ? ne(items.id, excludeItemId) : undefined,
        or(ilike(items.title, like), ilike(items.sku, like)),
      ),
    )
    .orderBy(asc(items.title))
    .limit(8);
}

// Move one store's listing to another item, e.g. when the same thing was entered twice.
// The listing itself doesn't change on the store; Relistic just tracks it under the other item.
export async function moveListing(itemId: string, connectionId: string, targetItemId: string): Promise<InventoryResult> {
  const user = await requireUser();
  if (![itemId, connectionId, targetItemId].every((v) => id.safeParse(v).success)) return { error: "Item not found." };
  if (itemId === targetItemId) return { error: "Pick a different item." };
  const [from, to, store] = await Promise.all([
    db.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.organizationId, user.organizationId)),
      with: { listings: true },
    }),
    db.query.items.findFirst({
      where: and(eq(items.id, targetItemId), eq(items.organizationId, user.organizationId)),
      with: { listings: true },
    }),
    db.query.connections.findFirst({
      where: and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)),
      columns: { id: true },
    }),
  ]);
  const listing = from?.listings.find((l) => l.connectionId === connectionId);
  if (!from || !to || !store || !listing) return { error: "Item or store not found." };
  const existing = to.listings.find((l) => l.connectionId === connectionId);
  if (existing && (existing.remoteListingId || existing.status === "listed" || existing.status === "waiting")) {
    return { error: "That item already has its own listing on this store." };
  }
  await db.transaction(async (tx) => {
    if (existing) await tx.delete(channelListings).where(eq(channelListings.id, existing.id));
    await tx.update(channelListings).set({ itemId: to.id }).where(eq(channelListings.id, listing.id));
  });
  revalidatePath("/items");
  revalidatePath(`/items/${from.id}`);
  revalidatePath(`/items/${to.id}`);
  return { message: `Moved to "${to.title}".` };
}

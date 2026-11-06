"use server";

import { and, count, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { channelListings, itemImages, items, photos, sales } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { writeProblem } from "@/lib/billing/access";
import { hasSold, SOLD_MESSAGE, stillUpMessage, storesStillUp } from "@/lib/item-delete";
import { photoUrl } from "@/lib/photos/links";
import { deletePhotoFiles } from "@/lib/photos/store";
import { syncItem } from "@/lib/sync/run";
import { MAX_TAGS, parseTags } from "@/lib/tags";

// The actions in the bar that opens when items are ticked on the Inventory page.
// Each one works on a single item, so the page can show how each went.

export type RowResult = { ok: boolean; message?: string };

const id = z.uuid();

async function loadItem(organizationId: string, itemId: string) {
  if (!id.safeParse(itemId).success) return null;
  return db.query.items.findFirst({
    where: and(eq(items.id, itemId), eq(items.organizationId, organizationId)),
    with: { listings: { with: { connection: { columns: { marketplace: true } } } } },
  });
}

function failures(outcomes: { ok: boolean; message?: string }[]): string | undefined {
  const bad = outcomes.filter((o) => !o.ok).map((o) => o.message);
  return bad.length ? bad.join(" ") : undefined;
}

// Push the item to its stores again (the same as Sync now on the item page).
export async function syncSelected(itemId: string): Promise<RowResult> {
  const user = await requireUser("items");
  const problem = await writeProblem(user);
  if (problem) return { ok: false, message: problem };
  const item = await loadItem(user.organizationId, itemId);
  if (!item) return { ok: false, message: "Item not found." };
  if (!item.listings.some((l) => l.enabled || l.status !== "not_listed")) {
    return { ok: true, message: "Not on any store yet." };
  }
  const error = failures(await syncItem(user.organizationId, item.id));
  revalidatePath("/items");
  return error ? { ok: false, message: error } : { ok: true };
}

// Take the item off every store, and keep it in Inventory (it shows under Delisted).
export async function delistSelected(itemId: string): Promise<RowResult> {
  const user = await requireUser("items");
  const item = await loadItem(user.organizationId, itemId);
  if (!item) return { ok: false, message: "Item not found." };
  if (!item.listings.some((l) => l.enabled)) return { ok: true, message: "It wasn't on any store." };
  await db.update(channelListings).set({ enabled: false }).where(eq(channelListings.itemId, item.id));
  const error = failures(await syncItem(user.organizationId, item.id));
  revalidatePath("/items");
  return error ? { ok: false, message: error } : { ok: true };
}

// Delete an item that hasn't sold: take it off its stores, then remove it and its photos.
export async function deleteSelected(itemId: string): Promise<RowResult> {
  const user = await requireUser("items");
  const item = await loadItem(user.organizationId, itemId);
  if (!item) return { ok: true, message: "Already deleted." };
  const [{ n }] = await db.select({ n: count() }).from(sales).where(eq(sales.itemId, item.id));
  if (hasSold(item, n)) return { ok: false, message: SOLD_MESSAGE };

  if (storesStillUp(item.listings).length) {
    await db.update(channelListings).set({ enabled: false }).where(eq(channelListings.itemId, item.id));
    await syncItem(user.organizationId, item.id);
    const after = await loadItem(user.organizationId, item.id);
    const up = after ? storesStillUp(after.listings) : [];
    if (up.length) {
      revalidatePath("/items");
      return { ok: false, message: stillUpMessage(up) };
    }
  }

  const removed = await db.transaction(async (tx) => {
    // A sale recorded while the stores were being updated keeps the item.
    const [{ sold }] = await tx.select({ sold: count() }).from(sales).where(eq(sales.itemId, item.id));
    if (sold > 0) return null;
    const own = await tx
      .select({ id: photos.id })
      .from(photos)
      .where(and(eq(photos.itemId, item.id), eq(photos.organizationId, user.organizationId)));
    // Keep a photo another item also uses.
    const shared = own.length
      ? new Set(
          (
            await tx
              .select({ url: itemImages.url })
              .from(itemImages)
              .innerJoin(items, eq(items.id, itemImages.itemId))
              .where(
                and(
                  eq(items.organizationId, user.organizationId),
                  ne(items.id, item.id),
                  inArray(itemImages.url, own.map((p) => photoUrl(p.id))),
                ),
              )
          ).map((r) => r.url),
        )
      : new Set<string>();
    const unused = own.filter((p) => !shared.has(photoUrl(p.id))).map((p) => p.id);
    if (unused.length) await tx.delete(photos).where(inArray(photos.id, unused));
    await tx.delete(items).where(eq(items.id, item.id));
    return unused;
  });
  if (!removed) return { ok: false, message: SOLD_MESSAGE };
  if (removed.length) await deletePhotoFiles(user.organizationId, removed);
  revalidatePath("/items");
  return { ok: true };
}

// Add tags to every ticked item, keeping the tags they already have.
export async function addTagsToSelected(itemIds: string[], text: string): Promise<{ error?: string; message?: string }> {
  const user = await requireUser("items");
  const ids = z.array(id).max(200).safeParse(itemIds);
  if (!ids.success || !ids.data.length) return { error: "Tick some items first." };
  const add = parseTags(text);
  if (!add.length) return { error: "Type a tag, like Bin 4. Separate tags with commas." };
  const rows = await db
    .select({ id: items.id, tags: items.tags })
    .from(items)
    .where(and(eq(items.organizationId, user.organizationId), inArray(items.id, ids.data)));
  let full = 0;
  for (const row of rows) {
    const tags = parseTags([...row.tags, ...add].join(","));
    if (tags.length === MAX_TAGS && row.tags.length + add.length > MAX_TAGS) full++;
    await db.update(items).set({ tags }).where(eq(items.id, row.id));
  }
  revalidatePath("/items");
  const what = `${add.join(", ")} added to ${rows.length} ${rows.length === 1 ? "item" : "items"}.`;
  return { message: full ? `${what} ${full} already had ${MAX_TAGS} tags, so not every tag fit.` : what };
}

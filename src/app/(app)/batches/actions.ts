"use server";

import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { batches, channelListings, connections, itemImages, items, photos } from "@/db/schema";
import { AiError, askForJson, jpegBlock } from "@/lib/ai/client";
import { batchSku, DRAFT_SYSTEM, draftSchema, draftToItem } from "@/lib/ai/draft";
import { normalizeGroups, SORT_SYSTEM, sortSchema } from "@/lib/ai/sort";
import { requireUser } from "@/lib/auth";
import { photoUrl } from "@/lib/photos/links";
import { MAX_PHOTOS_PER_ITEM } from "@/lib/photos/limits";
import { isConnectionReady } from "@/lib/stores";

export type BatchActionResult = { error?: string; itemId?: string };

// The AI sees at most this many photos per item; the rest still go on the listing.
const PHOTOS_FOR_DRAFT = 8;

function errorMessage(err: unknown): string {
  if (err instanceof AiError) return err.message;
  console.error(err);
  return "Something went wrong talking to the AI. Try again in a minute.";
}

async function ownBatch(organizationId: string, batchId: string) {
  const batch = await db.query.batches.findFirst({
    where: and(eq(batches.id, batchId), eq(batches.organizationId, organizationId)),
  });
  if (!batch) throw new Error("Batch not found");
  return batch;
}

export async function createBatch() {
  const user = await requireUser();
  const [{ last }] = await db
    .select({ last: max(batches.number) })
    .from(batches)
    .where(eq(batches.organizationId, user.organizationId));
  const [batch] = await db
    .insert(batches)
    .values({ organizationId: user.organizationId, number: (last ?? 0) + 1 })
    .returning({ id: batches.id });
  redirect(`/batches/${batch.id}`);
}

// Photos that haven't become an item yet, in upload order.
function openPhotos(batchId: string) {
  return and(eq(photos.batchId, batchId), isNull(photos.itemId));
}

// Group keys continue after any already used in the batch, so SKUs built from them
// never repeat even when more photos are sorted later.
async function nextGroupKey(batchId: string): Promise<number> {
  const [{ last }] = await db.select({ last: max(photos.groupKey) }).from(photos).where(eq(photos.batchId, batchId));
  return (last ?? -1) + 1;
}

export async function sortPhotos(batchId: string): Promise<BatchActionResult> {
  const user = await requireUser();
  await ownBatch(user.organizationId, batchId);
  const rows = await db
    .select({ id: photos.id, thumb: photos.thumb })
    .from(photos)
    .where(and(openPhotos(batchId), isNull(photos.groupKey)))
    .orderBy(asc(photos.position), asc(photos.createdAt));
  if (rows.length === 0) return { error: "There are no new photos to sort." };

  try {
    const answer = await askForJson({
      schema: sortSchema,
      system: SORT_SYSTEM,
      content: [
        ...rows.flatMap((row, i) => [{ type: "text" as const, text: `Photo ${i + 1}` }, jpegBlock(row.thumb)]),
        { type: "text", text: `Group these ${rows.length} photos by item.` },
      ],
      effort: "medium",
      maxTokens: 16000,
    });
    const groups = normalizeGroups(answer.items, rows.length);
    const firstKey = await nextGroupKey(batchId);
    await db.transaction(async (tx) => {
      for (const [g, group] of groups.entries()) {
        await tx
          .update(photos)
          .set({ groupKey: firstKey + g })
          .where(inArray(photos.id, group.photos.map((i) => rows[i].id)));
      }
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/batches/${batchId}`);
  return {};
}

// Move one photo to another item, to a new item of its own, or back to unsorted.
export async function movePhoto(photoId: string, target: string) {
  const user = await requireUser();
  const photo = await db.query.photos.findFirst({
    where: and(eq(photos.id, photoId), eq(photos.organizationId, user.organizationId), isNull(photos.itemId)),
    columns: { id: true, batchId: true },
  });
  if (!photo) return;
  const groupKey = target === "unsorted" ? null : target === "new" ? await nextGroupKey(photo.batchId) : Number(target);
  if (groupKey !== null && !Number.isInteger(groupKey)) return;
  await db.update(photos).set({ groupKey }).where(eq(photos.id, photo.id));
  revalidatePath(`/batches/${photo.batchId}`);
}

export async function deletePhoto(photoId: string) {
  const user = await requireUser();
  const [deleted] = await db
    .delete(photos)
    .where(and(eq(photos.id, photoId), eq(photos.organizationId, user.organizationId), isNull(photos.itemId)))
    .returning({ batchId: photos.batchId });
  if (deleted) revalidatePath(`/batches/${deleted.batchId}`);
}

// Write one draft listing from one group of photos and save it as a draft item.
export async function draftItem(batchId: string, groupKey: number): Promise<BatchActionResult> {
  const user = await requireUser();
  const batch = await ownBatch(user.organizationId, batchId);
  const group = await db
    .select({ id: photos.id, data: photos.data })
    .from(photos)
    .where(and(openPhotos(batchId), eq(photos.groupKey, groupKey)))
    .orderBy(asc(photos.position), asc(photos.createdAt))
    .limit(MAX_PHOTOS_PER_ITEM);
  if (group.length === 0) return { error: "Those photos have already been drafted." };

  let fields: ReturnType<typeof draftToItem>;
  try {
    const draft = await askForJson({
      schema: draftSchema,
      system: DRAFT_SYSTEM,
      content: [
        ...group.slice(0, PHOTOS_FOR_DRAFT).map((p) => jpegBlock(p.data)),
        { type: "text", text: "Write the listing for the item in these photos." },
      ],
      effort: "medium",
      maxTokens: 16000,
    });
    fields = draftToItem(draft);
  } catch (err) {
    return { error: errorMessage(err) };
  }

  let sku = batchSku(batch.number, groupKey);
  const taken = await db.query.items.findFirst({
    where: and(eq(items.organizationId, user.organizationId), eq(items.sku, sku)),
    columns: { id: true },
  });
  if (taken) sku = `${sku}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

  const orgConnections = await db.query.connections.findMany({
    where: eq(connections.organizationId, user.organizationId),
  });

  const itemId = await db.transaction(async (tx) => {
    // Lock the photos so the same group can't be drafted twice at once.
    const still = await tx
      .select({ id: photos.id })
      .from(photos)
      .where(and(inArray(photos.id, group.map((p) => p.id)), isNull(photos.itemId)))
      .for("update");
    if (still.length !== group.length) return null;

    const [item] = await tx
      .insert(items)
      .values({ ...fields, organizationId: user.organizationId, sku, quantity: 1, status: "draft", batchId })
      .returning({ id: items.id });
    await tx.insert(itemImages).values(group.map((p, position) => ({ itemId: item.id, url: photoUrl(p.id), position })));
    await tx.update(photos).set({ itemId: item.id }).where(inArray(photos.id, group.map((p) => p.id)));
    const ready = orgConnections.filter(isConnectionReady);
    if (ready.length) {
      await tx.insert(channelListings).values(
        ready.map((c) => ({
          itemId: item.id,
          connectionId: c.id,
          enabled: true,
          overrides: c.marketplace === "etsy" ? { whenMade: fields.draftNotes.whenMade } : {},
        })),
      );
    }
    return item.id;
  });
  if (!itemId) return { error: "Those photos have already been drafted." };

  revalidatePath(`/batches/${batchId}`);
  revalidatePath("/items");
  return { itemId };
}

// Start over on an item the AI got wrong: delete the draft and put its photos back.
export async function discardDraft(itemId: string) {
  const user = await requireUser();
  const item = await db.query.items.findFirst({
    where: and(eq(items.id, itemId), eq(items.organizationId, user.organizationId), eq(items.status, "draft")),
    with: { listings: { columns: { remoteListingId: true, remoteOfferId: true } } },
    columns: { id: true, batchId: true },
  });
  if (!item?.batchId || item.listings.some((l) => l.remoteListingId || l.remoteOfferId)) return;
  await db.transaction(async (tx) => {
    await tx.update(photos).set({ itemId: null }).where(eq(photos.itemId, item.id));
    await tx.delete(items).where(eq(items.id, item.id));
  });
  revalidatePath(`/batches/${item.batchId}`);
  revalidatePath("/items");
}

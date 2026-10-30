"use server";

import { and, asc, count, eq, inArray, isNull, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { batches, channelListings, connections, itemImages, items, photos } from "@/db/schema";
import { autoCategorizeForEbay } from "@/lib/ai/assist";
import { AiError, askForJson, jpegBlock } from "@/lib/ai/client";
import { batchSku, DRAFT_SYSTEM, draftSchema, draftToItem } from "@/lib/ai/draft";
import { groupsToKeep, normalizeGroups, SORT_CHUNK, SORT_SYSTEM, sortSchema } from "@/lib/ai/sort";
import { requireUser } from "@/lib/auth";
import { draftProblem, listingProblem, recordAiDraft, writeProblem } from "@/lib/billing/access";
import { photoUrl } from "@/lib/photos/links";
import { MAX_PHOTOS_PER_ITEM } from "@/lib/photos/limits";
import { deletePhotoFiles, readPhoto, readPhotos } from "@/lib/photos/store";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { postingProblems } from "@/lib/review";
import { isConnectionReady } from "@/lib/stores";
import { syncItem } from "@/lib/sync/run";

// `remaining` is how many photos are still waiting to be sorted after a sorting step.
export type BatchActionResult = { error?: string; itemId?: string; remaining?: number };

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
  if (await writeProblem(user)) redirect("/billing");
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

// Sorts the next chunk of unsorted photos. The page calls it again while photos remain.
export async function sortPhotos(batchId: string): Promise<BatchActionResult> {
  const user = await requireUser();
  const blocked = await writeProblem(user);
  if (blocked) return { error: blocked };
  await ownBatch(user.organizationId, batchId);
  const unsorted = and(openPhotos(batchId), isNull(photos.groupKey));
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(photos).where(unsorted),
    db
      .select({ id: photos.id, organizationId: photos.organizationId, thumb: photos.thumb })
      .from(photos)
      .where(unsorted)
      .orderBy(asc(photos.position), asc(photos.createdAt))
      .limit(SORT_CHUNK),
  ]);
  if (rows.length === 0) return { error: "There are no new photos to sort." };
  let sorted = 0;
  const thumbs = await Promise.all(rows.map((r) => readPhoto(r, "thumb")));

  try {
    const answer = await askForJson({
      schema: sortSchema,
      system: SORT_SYSTEM,
      content: [
        ...thumbs.flatMap((thumb, i) =>
          thumb
            ? [{ type: "text" as const, text: `Photo ${i + 1}` }, jpegBlock(thumb)]
            : [{ type: "text" as const, text: `Photo ${i + 1} (file missing; put it in a group of its own)` }],
        ),
        { type: "text", text: `Group these ${rows.length} photos by item.` },
      ],
      effort: "medium",
      maxTokens: 16000,
    });
    const groups = groupsToKeep(normalizeGroups(answer.items, rows.length), total > rows.length);
    sorted = groups.reduce((n, g) => n + g.photos.length, 0);
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
  return { remaining: total - sorted };
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
  if (!deleted) return;
  await deletePhotoFiles(user.organizationId, [photoId]);
  revalidatePath(`/batches/${deleted.batchId}`);
}

// Write one draft listing from one group of photos and save it as a draft item.
export async function draftItem(batchId: string, groupKey: number): Promise<BatchActionResult> {
  const user = await requireUser();
  const batch = await ownBatch(user.organizationId, batchId);
  const group = await db
    .select({ id: photos.id, organizationId: photos.organizationId, data: photos.data })
    .from(photos)
    .where(and(openPhotos(batchId), eq(photos.groupKey, groupKey)))
    .orderBy(asc(photos.position), asc(photos.createdAt))
    .limit(MAX_PHOTOS_PER_ITEM);
  if (group.length === 0) return { error: "Those photos have already been drafted." };
  const overLimit = await draftProblem(user);
  if (overLimit) return { error: overLimit };

  const draftPhotos = await readPhotos(group.slice(0, PHOTOS_FOR_DRAFT));
  let fields: ReturnType<typeof draftToItem>;
  try {
    const draft = await askForJson({
      schema: draftSchema,
      system: DRAFT_SYSTEM,
      content: [
        ...draftPhotos.map(jpegBlock),
        { type: "text", text: "Write the listing for the item in these photos." },
      ],
      effort: "medium",
      maxTokens: 16000,
    });
    fields = draftToItem(draft);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  await recordAiDraft(user.organizationId);

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

  // Best effort: a failure here leaves the category for the seller to pick.
  const ebay = orgConnections.find((c) => c.marketplace === "ebay" && isConnectionReady(c));
  if (ebay) {
    try {
      const picked = await autoCategorizeForEbay({
        connection: ebay,
        query: fields.draftNotes.categoryQuery ?? "",
        item: fields,
        photos: draftPhotos,
      });
      if (picked) {
        await db.transaction(async (tx) => {
          await tx.update(items).set({ attributes: picked.attributes }).where(eq(items.id, itemId));
          await tx
            .update(channelListings)
            .set({ overrides: { categoryId: picked.categoryId } })
            .where(and(eq(channelListings.itemId, itemId), eq(channelListings.connectionId, ebay.id)));
        });
      }
    } catch (err) {
      console.error("Couldn't pick an eBay category", err);
    }
  }

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

const quickEditSchema = z.object({
  title: z.string().trim().min(1, "Give the item a title").max(140, "Titles can be at most 140 characters"),
  price: z.string().refine((v) => Number(v) > 0, "Enter a price above zero"),
  condition: z.enum(EBAY_CONDITIONS.map((c) => c.value) as [string, ...string[]]),
});

// Title, price and condition edits straight from the review board.
export async function quickEdit(
  itemId: string,
  fields: { title: string; price: string; condition: string },
): Promise<BatchActionResult> {
  const user = await requireUser();
  const parsed = quickEditSchema.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [updated] = await db
    .update(items)
    .set({
      title: parsed.data.title,
      priceCents: Math.round(Number(parsed.data.price) * 100),
      condition: parsed.data.condition,
    })
    .where(and(eq(items.id, itemId), eq(items.organizationId, user.organizationId), eq(items.status, "draft")))
    .returning({ batchId: items.batchId });
  if (!updated) return { error: "That item has already been posted. Edit it from its own page." };
  if (updated.batchId) revalidatePath(`/batches/${updated.batchId}`);
  return {};
}

// Make one reviewed draft active and list it on its ticked stores.
export async function postDraft(itemId: string): Promise<BatchActionResult & { failed?: string[] }> {
  const user = await requireUser();
  const item = await db.query.items.findFirst({
    where: and(eq(items.id, itemId), eq(items.organizationId, user.organizationId)),
    with: { images: true, listings: { with: { connection: true } } },
  });
  if (!item) return { error: "Item not found." };
  if (item.status !== "draft") return { error: "Already posted." };
  const overLimit = await listingProblem(user);
  if (overLimit) return { error: overLimit };
  const problems = postingProblems(item);
  if (problems.length) return { error: problems.join(" ") };

  await db.update(items).set({ status: "active" }).where(eq(items.id, item.id));
  const outcomes = await syncItem(user.organizationId, item.id);
  if (item.batchId) revalidatePath(`/batches/${item.batchId}`);
  revalidatePath("/items");
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.message ?? o.store);
  return { itemId: item.id, failed: failed.length ? failed : undefined };
}

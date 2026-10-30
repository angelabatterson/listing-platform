"use server";

import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { channelListings, connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { syncItem } from "@/lib/sync/run";

export type AutomationsState = { error?: string; saved?: boolean; bestOfferChanged?: boolean } | undefined;

const pct = (min: number, max: number, message: string) => z.coerce.number().int(message).min(min, message).max(max, message);

const ebayAutomationsSchema = z
  .object({
    bestOfferEnabled: z.literal("on").optional(),
    acceptPct: pct(0, 99, "Auto-accept must be a whole number from 0 to 99."),
    declinePct: pct(0, 99, "Auto-decline must be a whole number from 0 to 99."),
    watcherOffersEnabled: z.literal("on").optional(),
    discountPct: pct(5, 80, "The watcher discount must be a whole number from 5 to 80."),
    message: z.string().trim().max(2000, "Keep the message under 2,000 characters."),
  })
  .refine((d) => !d.acceptPct || !d.declinePct || d.declinePct < d.acceptPct, {
    message: "The auto-decline percent has to be lower than the auto-accept percent.",
  });

async function findEbayStore(organizationId: string, connectionId: string) {
  return db.query.connections.findFirst({
    where: and(
      eq(connections.id, connectionId),
      eq(connections.organizationId, organizationId),
      eq(connections.marketplace, "ebay"),
    ),
  });
}

export async function saveEbayAutomations(
  connectionId: string,
  _prev: AutomationsState,
  formData: FormData,
): Promise<AutomationsState> {
  const user = await requireUser();
  const parsed = ebayAutomationsSchema.safeParse({ message: "", ...Object.fromEntries(formData) });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const connection = await findEbayStore(user.organizationId, connectionId);
  if (!connection) return { error: "Store not found" };

  const d = parsed.data;
  const before = connection.settings.automations ?? {};
  const bestOffer = { enabled: Boolean(d.bestOfferEnabled), acceptPct: d.acceptPct, declinePct: d.declinePct };
  const watcherOffers = {
    enabled: Boolean(d.watcherOffersEnabled),
    discountPct: d.discountPct,
    message: d.message || undefined,
    lastRunAt: before.watcherOffers?.lastRunAt,
  };
  // Saving the Best Offer section untouched, never set before and still off, changes nothing on eBay.
  const bestOfferChanged = before.bestOffer
    ? JSON.stringify(before.bestOffer) !== JSON.stringify(bestOffer)
    : bestOffer.enabled;

  await db
    .update(connections)
    .set({
      settings: {
        ...connection.settings,
        automations: { ...before, bestOffer: before.bestOffer || bestOffer.enabled ? bestOffer : undefined, watcherOffers },
      },
    })
    .where(eq(connections.id, connection.id));
  revalidatePath(`/automations/${connection.id}`);
  return { saved: true, bestOfferChanged };
}

export type ApplyStep = { error?: string; count: number; total: number; failed: number; next: string | null };

const APPLY_CHUNK = 10;

// Push the Best Offer settings to the store's live listings, a few per call, so the page
// can show progress. `after` is the last listing done; a listing that fails drops out of
// "listed", so counting by position would skip one.
export async function applyEbayBestOffer(connectionId: string, after: string | null): Promise<ApplyStep> {
  const user = await requireUser();
  const connection = await findEbayStore(user.organizationId, connectionId);
  if (!connection) return { error: "Store not found", count: 0, total: 0, failed: 0, next: null };

  const live = and(
    eq(channelListings.connectionId, connection.id),
    eq(channelListings.status, "listed"),
    isNotNull(channelListings.remoteListingId),
  );
  const total = await db.$count(channelListings, live);
  const chunk = await db
    .select({ id: channelListings.id, itemId: channelListings.itemId })
    .from(channelListings)
    .where(after ? and(live, gt(channelListings.id, after)) : live)
    .orderBy(asc(channelListings.id))
    .limit(APPLY_CHUNK);

  let failed = 0;
  for (const { itemId } of chunk) {
    const outcomes = await syncItem(user.organizationId, itemId, { only: connection.id });
    if (outcomes.some((o) => !o.ok)) failed++;
  }
  const next = chunk.length === APPLY_CHUNK ? chunk[chunk.length - 1].id : null;
  return { count: chunk.length, total, failed, next };
}

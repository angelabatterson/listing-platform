import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, extensionTasks, syncEvents, type ChannelListing, type Connection, type ExtensionTask } from "@/db/schema";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import type { ItemWithImages } from "@/lib/marketplaces/types";
import type { ChannelAction } from "@/lib/sync/plan";

const sortedImages = (item: ItemWithImages) => [...item.images].sort((a, b) => a.position - b.position);

// What the store's listing should show, as the extension fills it in.
export function listingContent(item: ItemWithImages, listing: Pick<ChannelListing, "overrides">) {
  return {
    title: listing.overrides.title ?? item.title,
    description: item.description,
    priceCents: listing.overrides.priceCents ?? item.priceCents,
    quantity: item.quantity,
    brand: item.brand,
    condition: item.condition,
    conditionLabel: EBAY_CONDITIONS.find((c) => c.value === item.condition)?.label ?? item.condition,
    sku: item.sku,
    attributes: item.attributes,
    photos: sortedImages(item).map((i) => i.url),
  };
}

export type ListingContent = ReturnType<typeof listingContent>;

// Changes when anything the store shows changes, so an unchanged item isn't re-posted.
export function fingerprint(content: ListingContent): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 32);
}

const MIN_PRICE_CENTS: Record<Connection["marketplace"], number> = {
  ebay: 0,
  etsy: 0,
  poshmark: 300,
  depop: 100,
  facebook: 100,
  mercari: 100,
  whatnot: 100,
  grailed: 100,
};

const MAX_TITLE: Partial<Record<Connection["marketplace"], number>> = { poshmark: 80, facebook: 100, mercari: 80 };

// Problems the store would reject, checked before the seller is asked to post.
export function validateForExtension(item: ItemWithImages, listing: ChannelListing, connection: Connection): string[] {
  const m = connection.marketplace;
  const c = listingContent(item, listing);
  const problems: string[] = [];
  if (c.photos.length === 0) problems.push("Add at least one photo.");
  if (!c.description.trim()) problems.push("Add a description.");
  const min = MIN_PRICE_CENTS[m];
  if (c.priceCents < min) problems.push(`The price must be at least $${(min / 100).toFixed(2)}.`);
  const max = MAX_TITLE[m];
  if (max && c.title.length > max) problems.push(`The title must be ${max} characters or fewer (it's ${c.title.length}).`);
  return problems;
}

async function openTask(listingId: string) {
  return db.query.extensionTasks.findFirst({
    where: and(eq(extensionTasks.listingId, listingId), eq(extensionTasks.status, "open")),
  });
}

export async function cancelOpenTasks(listingId: string) {
  await db
    .update(extensionTasks)
    .set({ status: "cancelled" })
    .where(and(eq(extensionTasks.listingId, listingId), eq(extensionTasks.status, "open")));
}

// The status a listing returns to when its queued work is dropped.
const settledStatus = (listing: Pick<ChannelListing, "remoteListingId" | "remoteUrl" | "status">) =>
  listing.remoteListingId || listing.remoteUrl ? ("listed" as const) : ("not_listed" as const);

// Queue (or drop) work for the extension so the listing matches the item.
// Returns a message for the activity log, or null when nothing changed.
export async function planExtensionWork(
  item: ItemWithImages,
  listing: ChannelListing,
  connection: Connection,
  action: ChannelAction,
): Promise<string | null> {
  const store = MARKETPLACE_LABELS[connection.marketplace];
  const pending = await openTask(listing.id);
  const posted = Boolean(listing.remoteListingId || listing.remoteUrl);

  if (action === "none") {
    // The item no longer needs posting (made a draft, unticked): drop the request.
    if (pending && pending.kind !== "end") {
      await cancelOpenTasks(listing.id);
      await db.update(channelListings).set({ status: settledStatus(listing) }).where(eq(channelListings.id, listing.id));
      return `${store}: no longer waiting to post`;
    }
    return null;
  }

  if (action === "end") {
    if (pending?.kind === "end") return null;
    await cancelOpenTasks(listing.id);
    if (!posted) {
      await db.update(channelListings).set({ status: "not_listed", lastError: null }).where(eq(channelListings.id, listing.id));
      return pending ? `${store}: no longer waiting to post` : null;
    }
    await db.insert(extensionTasks).values({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      listingId: listing.id,
      kind: "end",
    });
    await db.update(channelListings).set({ status: "waiting", lastError: null }).where(eq(channelListings.id, listing.id));
    return `${store}: waiting for the Relistic extension to take the listing down`;
  }

  const fp = fingerprint(listingContent(item, listing));
  if (posted && listing.status === "listed" && listing.postedFingerprint === fp) return null;
  const kind = posted ? ("update" as const) : ("list" as const);
  if (pending && pending.kind === kind && pending.fingerprint === fp) return null;
  await cancelOpenTasks(listing.id);
  await db.insert(extensionTasks).values({
    organizationId: connection.organizationId,
    connectionId: connection.id,
    listingId: listing.id,
    kind,
    fingerprint: fp,
  });
  await db.update(channelListings).set({ status: "waiting", lastError: null }).where(eq(channelListings.id, listing.id));
  return kind === "list"
    ? `${store}: waiting for you to post it with the Relistic extension`
    : `${store}: waiting for you to update it with the Relistic extension`;
}

// The open work for an account, with everything the extension needs to fill in each listing.
export async function openTasksFor(organizationId: string) {
  const tasks = await db.query.extensionTasks.findMany({
    where: and(eq(extensionTasks.organizationId, organizationId), eq(extensionTasks.status, "open")),
    orderBy: asc(extensionTasks.createdAt),
    with: { connection: true, listing: { with: { item: { with: { images: true } } } } },
  });
  return tasks.map((t) => ({
    id: t.id,
    kind: t.kind,
    marketplace: t.connection.marketplace,
    store: MARKETPLACE_LABELS[t.connection.marketplace],
    itemId: t.listing.itemId,
    remoteListingId: t.listing.remoteListingId,
    remoteUrl: t.listing.remoteUrl,
    createdAt: t.createdAt,
    listing: listingContent(t.listing.item, t.listing),
  }));
}

export type TaskReport =
  | { result: "done"; remoteListingId?: string; url?: string }
  | { result: "failed"; error: string }
  | { result: "skipped" };

// Record what the extension (or the seller) did with a task.
export async function reportTask(organizationId: string, taskId: string, report: TaskReport): Promise<ExtensionTask | null> {
  const task = await db.query.extensionTasks.findFirst({
    where: and(eq(extensionTasks.id, taskId), eq(extensionTasks.organizationId, organizationId)),
    with: { connection: true, listing: true },
  });
  if (!task || task.status !== "open") return null;
  const store = MARKETPLACE_LABELS[task.connection.marketplace];
  const { listing } = task;
  let message: string;
  let ok = true;

  if (report.result === "done") {
    await db.update(extensionTasks).set({ status: "done" }).where(eq(extensionTasks.id, task.id));
    if (task.kind === "end") {
      await db
        .update(channelListings)
        .set({ status: "ended", lastSyncedAt: new Date(), lastError: null })
        .where(eq(channelListings.id, listing.id));
      message = `${store}: listing taken down`;
    } else {
      await db
        .update(channelListings)
        .set({
          status: "listed",
          remoteListingId: report.remoteListingId ?? listing.remoteListingId,
          remoteUrl: report.url ?? listing.remoteUrl,
          postedFingerprint: task.fingerprint,
          lastSyncedAt: new Date(),
          lastError: null,
        })
        .where(eq(channelListings.id, listing.id));
      message = task.kind === "list" ? `${store}: posted` : `${store}: updated`;
    }
  } else if (report.result === "failed") {
    ok = false;
    await db.update(extensionTasks).set({ status: "failed", error: report.error }).where(eq(extensionTasks.id, task.id));
    await db
      .update(channelListings)
      .set({ status: "error", lastError: report.error, lastSyncedAt: new Date() })
      .where(eq(channelListings.id, listing.id));
    message = `${store}: ${report.error}`;
  } else {
    await db.update(extensionTasks).set({ status: "cancelled" }).where(eq(extensionTasks.id, task.id));
    await db.update(channelListings).set({ status: settledStatus(listing) }).where(eq(channelListings.id, listing.id));
    message = `${store}: skipped in the extension`;
  }

  await db.insert(syncEvents).values({
    organizationId,
    itemId: listing.itemId,
    connectionId: task.connectionId,
    action: task.kind === "end" ? "end" : "publish",
    ok,
    message,
  });
  return task;
}

// How many tasks are waiting, per store, for the Stores page.
export async function openTaskCounts(organizationId: string, connectionIds: string[]) {
  if (connectionIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ connectionId: extensionTasks.connectionId })
    .from(extensionTasks)
    .where(and(eq(extensionTasks.organizationId, organizationId), eq(extensionTasks.status, "open"), inArray(extensionTasks.connectionId, connectionIds)));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.connectionId, (counts.get(r.connectionId) ?? 0) + 1);
  return counts;
}

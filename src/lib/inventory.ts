import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { channelListings, items } from "@/db/schema";
import { AUTO_SKU_PATTERN } from "@/lib/sku";

export const VIEWS = {
  all: "All",
  listed: "Listed",
  drafts: "Drafts",
  scheduled: "Scheduled",
  sold: "Sold",
  delisted: "Delisted",
  favorites: "Favorites",
  duplicates: "Duplicates",
  archived: "Archived",
} as const;
export type View = keyof typeof VIEWS;

export const ISSUES = {
  error: "Needs attention",
  waiting: "Waiting in extension",
  unlisted: "Active but not listed anywhere",
  nosku: "Missing SKU",
} as const;
export type Issue = keyof typeof ISSUES;

export const SORTS = {
  updated: "Recently changed",
  newest: "Newest first",
  oldest: "Oldest first",
  "price-high": "Price: high to low",
  "price-low": "Price: low to high",
  title: "Title A to Z",
} as const;
export type Sort = keyof typeof SORTS;

export const PAGE_SIZE = 50;

export type InventoryFilters = {
  view: View;
  q: string;
  store: string;
  issue: Issue | "";
  tag: string;
  sort: Sort;
  page: number;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pick = <T extends string>(value: string, options: Record<T, string>, fallback: T): T =>
  value in options ? (value as T) : fallback;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read the filters from the page address, ignoring anything unexpected.
export function parseFilters(params: Record<string, string | string[] | undefined>): InventoryFilters {
  const page = Number.parseInt(one(params.page), 10);
  const store = one(params.store);
  return {
    view: pick(one(params.view), VIEWS, "all"),
    q: one(params.q).trim().slice(0, 100),
    store: UUID.test(store) ? store : "",
    issue: one(params.issue) in ISSUES ? (one(params.issue) as Issue) : "",
    tag: one(params.tag).trim().slice(0, 40),
    sort: pick(one(params.sort), SORTS, "updated"),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

// The filters as a page address, leaving out the defaults; `change` overrides some.
export function filterHref(f: InventoryFilters, change: Partial<InventoryFilters> = {}): string {
  const next = { ...f, page: 1, ...change };
  const params = new URLSearchParams();
  if (next.view !== "all") params.set("view", next.view);
  if (next.q) params.set("q", next.q);
  if (next.store) params.set("store", next.store);
  if (next.issue) params.set("issue", next.issue);
  if (next.tag) params.set("tag", next.tag);
  if (next.sort !== "updated") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/items?${query}` : "/items";
}

const hasListing = (condition: SQL) =>
  sql`exists (select 1 from ${channelListings} where ${channelListings.itemId} = ${items.id} and ${condition})`;

// Another item in the account with the same title (ignoring case and outer spaces).
const hasTwin = sql`exists (select 1 from ${items} as twin where twin.organization_id = ${items.organizationId}
  and twin.id <> ${items.id} and twin.status <> 'archived' and lower(btrim(twin.title)) = lower(btrim(${items.title})))`;

const viewCondition: Record<View, SQL> = {
  all: ne(items.status, "archived"),
  listed: eq(items.status, "active"),
  drafts: eq(items.status, "draft"),
  scheduled: and(eq(items.status, "draft"), isNotNull(items.scheduledAt))!,
  sold: eq(items.status, "sold_out"),
  // Taken off its stores but not sold: something ended, and nothing is up or on its way.
  delisted: and(
    eq(items.status, "active"),
    hasListing(sql`${channelListings.status} = 'ended'`),
    sql`not ${hasListing(sql`${channelListings.status} in ('listed', 'waiting')`)}`,
  )!,
  favorites: and(ne(items.status, "archived"), eq(items.favorite, true))!,
  duplicates: and(ne(items.status, "archived"), hasTwin)!,
  archived: eq(items.status, "archived"),
};

// Everything but the tab, shared by the list and the tab counts.
function narrowing(orgId: string, f: InventoryFilters): SQL[] {
  const conditions = [eq(items.organizationId, orgId)];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(items.title, like), ilike(items.sku, like))!);
  }
  if (f.store) {
    conditions.push(hasListing(sql`${channelListings.connectionId} = ${f.store} and ${channelListings.enabled}`));
  }
  if (f.issue === "error") conditions.push(hasListing(sql`${channelListings.status} = 'error'`));
  if (f.issue === "waiting") conditions.push(hasListing(sql`${channelListings.status} = 'waiting'`));
  if (f.issue === "unlisted") {
    conditions.push(eq(items.status, "active"), sql`not ${hasListing(sql`${channelListings.status} = 'listed'`)}`);
  }
  if (f.issue === "nosku") conditions.push(sql`${items.sku} ~ ${AUTO_SKU_PATTERN}`);
  if (f.tag) conditions.push(sql`${items.tags} @> array[${f.tag}]::text[]`);
  return conditions;
}

const ORDER: Record<Sort, SQL[]> = {
  updated: [desc(items.updatedAt)],
  newest: [desc(items.createdAt)],
  oldest: [asc(items.createdAt)],
  "price-high": [desc(items.priceCents), desc(items.updatedAt)],
  "price-low": [asc(items.priceCents), desc(items.updatedAt)],
  title: [asc(sql`lower(${items.title})`)],
};

// Scheduled drafts in the order they'll go up.
const SCHEDULED_ORDER = [asc(items.scheduledAt)];

// Duplicates sit next to each other, so the seller can compare them.
const DUPLICATE_ORDER = [asc(sql`lower(btrim(${items.title}))`), asc(items.createdAt)];

// One page of items matching the filters, with their store listings.
export async function listInventory(orgId: string, f: InventoryFilters) {
  const where = and(...narrowing(orgId, f), viewCondition[f.view]);
  const [ids, [{ total }]] = await Promise.all([
    db
      .select({ id: items.id })
      .from(items)
      .where(where)
      .orderBy(...(f.view === "duplicates" ? DUPLICATE_ORDER : f.view === "scheduled" ? SCHEDULED_ORDER : ORDER[f.sort]), asc(items.id))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(items).where(where),
  ]);
  const rows = ids.length
    ? await db.query.items.findMany({
        where: inArray(items.id, ids.map((r) => r.id)),
        with: { listings: { with: { connection: true } }, images: true },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { rows: ids.map((r) => byId.get(r.id)!), total };
}

// How many items each tab would show with the other filters applied.
export async function viewCounts(orgId: string, f: InventoryFilters): Promise<Record<View, number>> {
  const narrowed = narrowing(orgId, f);
  const countOf = async (view: View) =>
    (await db.select({ n: count() }).from(items).where(and(...narrowed, viewCondition[view])))[0].n;
  const [rows, scheduled, delisted, favorites, duplicates] = await Promise.all([
    db.select({ status: items.status, n: count() }).from(items).where(and(...narrowed)).groupBy(items.status),
    countOf("scheduled"),
    countOf("delisted"),
    countOf("favorites"),
    countOf("duplicates"),
  ]);
  const by = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return {
    all: by("active") + by("draft") + by("sold_out"),
    listed: by("active"),
    drafts: by("draft"),
    scheduled,
    sold: by("sold_out"),
    delisted,
    favorites,
    duplicates,
    archived: by("archived"),
  };
}

// Every tag the account uses, for the tag filter.
export async function allTags(orgId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ tag: sql<string>`unnest(${items.tags})` })
    .from(items)
    .where(eq(items.organizationId, orgId));
  return rows.map((r) => r.tag).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

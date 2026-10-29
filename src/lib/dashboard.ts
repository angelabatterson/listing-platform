import "server-only";
import { and, asc, eq, gt, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { connections, items, sales } from "@/db/schema";

export const RANGES = {
  "30d": "Last 30 days",
  month: "This month",
  "last-month": "Last month",
  year: "This year",
  all: "All time",
} as const;
export type RangeKey = keyof typeof RANGES;

export const isRangeKey = (v: unknown): v is RangeKey => typeof v === "string" && v in RANGES;

// Reports use UTC calendar months.
export function rangeBounds(range: RangeKey, now = new Date()): { from: Date | null; to: Date | null } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (range) {
    case "30d":
      return { from: new Date(now.getTime() - 30 * 86_400_000), to: null };
    case "month":
      return { from: new Date(Date.UTC(y, m, 1)), to: null };
    case "last-month":
      return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
    case "year":
      return { from: new Date(Date.UTC(y, 0, 1)), to: null };
    case "all":
      return { from: null, to: null };
  }
}

function inRange(orgId: string, from: Date | null, to: Date | null): SQL {
  return and(
    eq(sales.organizationId, orgId),
    from ? gte(sales.soldAt, from) : undefined,
    to ? lt(sales.soldAt, to) : undefined,
  )!;
}

// Profit is item sales less store fees and what the seller paid. Shipping charged to
// the buyer isn't counted, since the label cost isn't known yet.
const totals = {
  lines: sql<number>`count(*)::int`,
  units: sql<number>`coalesce(sum(${sales.quantity}), 0)::int`,
  sales: sql<number>`coalesce(sum(${sales.priceCents}), 0)::int`,
  shipping: sql<number>`coalesce(sum(${sales.shippingCents}), 0)::int`,
  fees: sql<number>`coalesce(sum(${sales.feesCents}), 0)::int`,
  cost: sql<number>`coalesce(sum(${items.costCents} * ${sales.quantity}), 0)::int`,
  unpriced: sql<number>`count(*) filter (where ${sales.priceCents} is null)::int`,
  uncosted: sql<number>`count(*) filter (where ${items.costCents} is null)::int`,
  estimatedFees: sql<number>`count(*) filter (where ${sales.feesEstimated})::int`,
};

export type Totals = { [K in keyof typeof totals]: number } & { profit: number };

const withProfit = <T extends Omit<Totals, "profit">>(row: T) => ({ ...row, profit: row.sales - row.fees - row.cost });

export async function salesTotals(orgId: string, from: Date | null, to: Date | null): Promise<Totals> {
  const [row] = await db
    .select(totals)
    .from(sales)
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(inRange(orgId, from, to));
  return withProfit(row);
}

export async function salesByStore(orgId: string, from: Date | null, to: Date | null) {
  const rows = await db
    .select({ marketplace: connections.marketplace, ...totals })
    .from(sales)
    .innerJoin(connections, eq(connections.id, sales.connectionId))
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(inRange(orgId, from, to))
    .groupBy(connections.marketplace)
    .orderBy(connections.marketplace);
  return rows.map(withProfit);
}

// The last 12 calendar months, newest first, including months with no sales.
export async function salesByMonth(orgId: string, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const month = sql<string>`to_char(${sales.soldAt} at time zone 'UTC', 'YYYY-MM')`;
  const rows = await db
    .select({ month, ...totals })
    .from(sales)
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(inRange(orgId, from, null))
    .groupBy(month);
  const byMonth = new Map(rows.map((r) => [r.month, withProfit(r)]));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    return { month: d, totals: byMonth.get(key) ?? null };
  });
}

export async function inventorySummary(orgId: string) {
  const [row] = await db
    .select({
      items: sql<number>`count(*)::int`,
      units: sql<number>`coalesce(sum(${items.quantity}), 0)::int`,
      value: sql<number>`coalesce(sum(${items.priceCents} * ${items.quantity}), 0)::int`,
      cost: sql<number>`coalesce(sum(${items.costCents} * ${items.quantity}), 0)::int`,
    })
    .from(items)
    .where(and(eq(items.organizationId, orgId), eq(items.status, "active"), gt(items.quantity, 0)));
  return row;
}

export const STALE_DAYS = 60;

// Active items that have been in stock the longest without selling.
export async function staleItems(orgId: string, now = new Date(), limit = 20) {
  const rows = await db
    .select({ id: items.id, sku: items.sku, title: items.title, priceCents: items.priceCents, createdAt: items.createdAt })
    .from(items)
    .where(
      and(
        eq(items.organizationId, orgId),
        eq(items.status, "active"),
        gt(items.quantity, 0),
        lt(items.createdAt, new Date(now.getTime() - STALE_DAYS * 86_400_000)),
      ),
    )
    .orderBy(asc(items.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, days: Math.floor((now.getTime() - r.createdAt.getTime()) / 86_400_000) }));
}

// Buyers across all stores, biggest spenders first. A buyer is one account on one
// store, so the same person on eBay and Etsy shows twice.
export async function buyers(orgId: string, limit = 100) {
  const orders = sql<number>`count(distinct ${sales.externalOrderId})::int`;
  const spent = sql<number>`coalesce(sum(${sales.priceCents}), 0) + coalesce(sum(${sales.shippingCents}), 0)`;
  return db
    .select({
      marketplace: connections.marketplace,
      buyerId: sales.buyerId,
      name: sql<string | null>`max(${sales.buyerName})`,
      orders,
      units: sql<number>`sum(${sales.quantity})::int`,
      spent: sql<number>`(${spent})::int`,
      lastBought: sql<Date>`max(${sales.soldAt})`.mapWith(sales.soldAt),
    })
    .from(sales)
    .innerJoin(connections, eq(connections.id, sales.connectionId))
    .where(and(eq(sales.organizationId, orgId), sql`${sales.buyerId} is not null`))
    .groupBy(connections.marketplace, sales.buyerId)
    .orderBy(sql`${spent} desc`, sql`max(${sales.soldAt}) desc`)
    .limit(limit);
}

export async function recentSales(orgId: string, limit = 10) {
  return db
    .select({
      id: sales.id,
      soldAt: sales.soldAt,
      title: sql<string | null>`coalesce(${items.title}, ${sales.title})`,
      itemId: sales.itemId,
      quantity: sales.quantity,
      priceCents: sales.priceCents,
      feesCents: sales.feesCents,
      costCents: items.costCents,
      marketplace: connections.marketplace,
      buyerName: sales.buyerName,
    })
    .from(sales)
    .innerJoin(connections, eq(connections.id, sales.connectionId))
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(eq(sales.organizationId, orgId))
    .orderBy(sql`${sales.soldAt} desc`)
    .limit(limit);
}

// Every purchase by buyers with a known id, newest first, for the buyer list.
export async function buyerPurchases(orgId: string) {
  return db
    .select({
      id: sales.id,
      marketplace: connections.marketplace,
      buyerId: sales.buyerId,
      soldAt: sales.soldAt,
      itemId: sales.itemId,
      title: sql<string | null>`coalesce(${items.title}, ${sales.title})`,
      quantity: sales.quantity,
      priceCents: sales.priceCents,
    })
    .from(sales)
    .innerJoin(connections, eq(connections.id, sales.connectionId))
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(and(eq(sales.organizationId, orgId), sql`${sales.buyerId} is not null`))
    .orderBy(sql`${sales.soldAt} desc`)
    .limit(5000);
}

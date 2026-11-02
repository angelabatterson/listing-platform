import "server-only";
import { and, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { connections, itemImages, items, sales, shippingLabels, type Connection } from "@/db/schema";
import { dollars, MONEY_FIELD_KEYS, MONEY_FIELDS, type MoneyField } from "@/lib/sale-fields";
import { storeLabel } from "@/lib/stores";

// The Sales page: every sale with its money worked out, like a reseller's spreadsheet.

export const SALES_PAGE_SIZE = 50;

export type SalesFilters = { q: string; store: string; page: number };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSalesFilters(params: Record<string, string | string[] | undefined>): SalesFilters {
  const page = Number.parseInt(one(params.page), 10);
  const store = one(params.store);
  return {
    q: one(params.q).trim().slice(0, 100),
    store: UUID.test(store) ? store : "",
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

export function salesHref(f: SalesFilters, change: Partial<SalesFilters> = {}): string {
  const next = { ...f, page: 1, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.store) params.set("store", next.store);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/sales?${query}` : "/sales";
}

// Each part of a sale's profit, in cents. `costKnown` is false when nothing says what the
// item cost, so the profit leaves it out.
export type SaleMoney = {
  price: number;
  shipping: number;
  tax: number;
  refund: number;
  fees: number;
  shippingCost: number;
  cost: number;
  other: number;
  profit: number;
  costKnown: boolean;
  feesEstimated: boolean;
};

export function saleMoney(
  sale: Pick<
    typeof sales.$inferSelect,
    "priceCents" | "shippingCents" | "taxCents" | "refundCents" | "feesCents" | "feesEstimated" | "shippingCostCents" | "costCents" | "otherCostCents" | "quantity"
  >,
  itemCostCents: number | null,
  labelCostCents: number,
): SaleMoney {
  const price = sale.priceCents ?? 0;
  const shipping = sale.shippingCents ?? 0;
  const refund = sale.refundCents ?? 0;
  const fees = sale.feesCents ?? 0;
  const shippingCost = sale.shippingCostCents ?? labelCostCents;
  const itemCost = itemCostCents === null ? null : itemCostCents * sale.quantity;
  const cost = sale.costCents ?? itemCost ?? 0;
  const other = sale.otherCostCents ?? 0;
  return {
    price,
    shipping,
    tax: sale.taxCents ?? 0,
    refund,
    fees,
    shippingCost,
    cost,
    other,
    profit: price + shipping - refund - fees - shippingCost - cost - other,
    costKnown: sale.costCents !== null || itemCost !== null,
    feesEstimated: sale.feesEstimated,
  };
}

// Where the seller opens the order on the store, which is also where each store sells its
// own shipping labels. Extension stores have no order ids from Relistic, so they get the
// store's list of sold items.
export function storeOrderLink(store: Pick<Connection, "marketplace" | "environment" | "settings">, orderId: string, manual: boolean): string | null {
  const id = encodeURIComponent(orderId);
  switch (store.marketplace) {
    case "ebay":
      if (manual) return "https://www.ebay.com/sh/ord";
      return `https://www.${store.environment === "sandbox" ? "sandbox." : ""}ebay.com/sh/ord/details?orderid=${id}`;
    case "etsy":
      return manual ? "https://www.etsy.com/your/orders/sold" : `https://www.etsy.com/your/orders/sold?order_id=${id}`;
    case "shopify":
      return store.settings.shopDomain ? `https://${store.settings.shopDomain}/admin/orders${manual ? "" : `/${id}`}` : null;
    case "tiktok":
      return manual ? "https://seller-us.tiktok.com/order" : `https://seller-us.tiktok.com/order/detail?order_no=${id}`;
    case "poshmark":
      return "https://poshmark.com/order/sales";
    case "mercari":
      return "https://www.mercari.com/mypage/listings/in_progress/";
    case "depop":
      return "https://www.depop.com/sellinghub/sold-items/";
    case "grailed":
      return "https://www.grailed.com/users/sold";
    case "whatnot":
      return "https://www.whatnot.com/dashboard/orders";
    case "facebook":
      return "https://www.facebook.com/marketplace/you/selling";
    default:
      return null;
  }
}

function narrowing(orgId: string, f: SalesFilters): SQL[] {
  const conditions = [eq(sales.organizationId, orgId)];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(sales.title, like), ilike(sales.sku, like), ilike(items.title, like), ilike(items.sku, like))!);
  }
  if (f.store) conditions.push(eq(sales.connectionId, f.store));
  return conditions;
}

const saleRow = {
  sale: sales,
  store: connections,
  item: { id: items.id, title: items.title, sku: items.sku, quantity: items.quantity, costCents: items.costCents },
};

// One page of sales, newest first, with each one's money worked out.
export async function listSales(orgId: string, f: SalesFilters, pageSize = SALES_PAGE_SIZE) {
  const where = and(...narrowing(orgId, f));
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(saleRow)
      .from(sales)
      .innerJoin(connections, eq(connections.id, sales.connectionId))
      .leftJoin(items, eq(items.id, sales.itemId))
      .where(where)
      .orderBy(desc(sales.soldAt), desc(sales.id))
      .limit(pageSize)
      .offset((f.page - 1) * pageSize),
    db.select({ total: count() }).from(sales).leftJoin(items, eq(items.id, sales.itemId)).where(where),
  ]);
  return { rows: await withMoney(orgId, rows), total };
}

// Every sale matching the filters (newest first), for the spreadsheet download.
export async function allSales(orgId: string, f: SalesFilters, limit = 20_000) {
  const rows = await db
    .select(saleRow)
    .from(sales)
    .innerJoin(connections, eq(connections.id, sales.connectionId))
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(and(...narrowing(orgId, f)))
    .orderBy(desc(sales.soldAt), desc(sales.id))
    .limit(limit);
  return withMoney(orgId, rows);
}

// Particular sales by id (only the organization's own), for the spreadsheet upload.
export async function salesById(orgId: string, ids: string[]) {
  const wanted = ids.filter((v) => UUID.test(v));
  if (!wanted.length) return [];
  const rows = await db
    .select(saleRow)
    .from(sales)
    .innerJoin(connections, eq(connections.id, sales.connectionId))
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(and(eq(sales.organizationId, orgId), inArray(sales.id, wanted)));
  return withMoney(orgId, rows);
}

type SaleRow = {
  sale: typeof sales.$inferSelect;
  store: Connection;
  item: { id: string; title: string; sku: string; quantity: number; costCents: number | null } | null;
};
export type SaleWithMoney = Awaited<ReturnType<typeof withMoney>>[number];

// Add each sale's photo, shipping label, money and store order link.
async function withMoney(orgId: string, rows: SaleRow[]) {
  if (!rows.length) return [];
  const itemIds = [...new Set(rows.map((r) => r.item?.id).filter((v): v is string => Boolean(v)))];
  const orderIds = [...new Set(rows.map((r) => r.sale.externalOrderId))];
  const [photos, labels, orderLines] = await Promise.all([
    itemIds.length ? db.select().from(itemImages).where(inArray(itemImages.itemId, itemIds)) : [],
    db
      .select()
      .from(shippingLabels)
      .where(and(eq(shippingLabels.organizationId, orgId), inArray(shippingLabels.externalOrderId, orderIds))),
    // Every line of these orders, so a label's cost is counted once per order.
    db
      .select({ id: sales.id, connectionId: sales.connectionId, orderId: sales.externalOrderId, lineId: sales.externalLineId })
      .from(sales)
      .where(and(eq(sales.organizationId, orgId), inArray(sales.externalOrderId, orderIds))),
  ]);
  const firstPhoto = new Map<string, string>();
  for (const p of [...photos].sort((a, b) => a.position - b.position)) if (!firstPhoto.has(p.itemId)) firstPhoto.set(p.itemId, p.url);
  const orderKey = (connectionId: string, orderId: string) => `${connectionId}:${orderId}`;
  const firstLine = new Map<string, string>();
  for (const l of [...orderLines].sort((a, b) => a.lineId.localeCompare(b.lineId))) {
    if (!firstLine.has(orderKey(l.connectionId, l.orderId))) firstLine.set(orderKey(l.connectionId, l.orderId), l.id);
  }

  return rows.map(({ sale, store, item }) => {
    const key = orderKey(sale.connectionId, sale.externalOrderId);
    const orderLabels = sale.manual ? [] : labels.filter((l) => orderKey(l.connectionId, l.externalOrderId) === key);
    const labelCost = firstLine.get(key) === sale.id ? orderLabels.reduce((n, l) => n + l.costCents, 0) : 0;
    return {
      sale,
      store,
      item,
      photo: item ? (firstPhoto.get(item.id) ?? null) : null,
      label: orderLabels[0] ?? null,
      money: saleMoney(sale, item?.costCents ?? null, labelCost),
      orderLink: storeOrderLink(store, sale.externalOrderId, sale.manual),
    };
  });
}

export const SALES_CSV_HEADINGS = [
  "Sale ID",
  "Date",
  "Store",
  "Order",
  "Title",
  "SKU",
  "Qty",
  ...MONEY_FIELD_KEYS.map((k) => MONEY_FIELDS[k].heading),
  "Profit",
  "Buyer",
];

// The Sales page as spreadsheet rows. Amounts Relistic worked out (like cost from the
// item) are filled in, so the sheet adds up; uploading it again only saves the ones you changed.
export function salesCsvRows(rows: SaleWithMoney[]): (string | number)[][] {
  return [
    SALES_CSV_HEADINGS,
    ...rows.map(({ sale, store, item, money }) => [
      sale.id,
      sale.soldAt.toISOString().slice(0, 10),
      storeLabel(store),
      sale.manual ? "" : sale.externalOrderId,
      item?.title ?? sale.title ?? "",
      item?.sku ?? sale.sku ?? "",
      sale.quantity,
      ...MONEY_FIELD_KEYS.map((k) => {
        const cents = moneyValue(sale, money, k);
        return cents === null ? "" : dollars(cents);
      }),
      dollars(money.profit),
      sale.buyerName ?? "",
    ]),
  ];
}

// What a money box shows: the store's figure, the seller's own, or Relistic's estimate.
// Null only when the store never reported the price, shipping or fees.
export function moneyValue(sale: typeof sales.$inferSelect, money: SaleMoney, field: MoneyField): number | null {
  if (field === "price" || field === "shipping" || field === "fees") return sale[MONEY_FIELDS[field].column];
  if (field === "cost" && !money.costKnown) return null;
  return money[field];
}

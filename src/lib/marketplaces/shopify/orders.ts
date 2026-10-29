import type { Connection } from "@/db/schema";
import { apportion, toCents, type SaleLine } from "../orders";
import { fromGid, shopifyGraphql } from "./client";

type Money = { shopMoney: { amount: string; currencyCode: string } } | null;

export type ShopifyOrder = {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  totalShippingPriceSet: Money;
  lineItems: {
    nodes: {
      id: string;
      sku: string | null;
      title: string;
      quantity: number;
      product: { id: string } | null;
      discountedTotalSet: Money;
    }[];
  };
};

// Orders that count as sold. Pending or voided payments don't take stock yet.
const SOLD = new Set(["PAID", "AUTHORIZED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"]);

// Shopify doesn't report its payment fees here, and buyer details need extra approval
// from Shopify, so neither is recorded.
export function orderToSales(order: ShopifyOrder): SaleLine[] {
  if (order.cancelledAt || !SOLD.has(order.displayFinancialStatus ?? "")) return [];
  const lines = order.lineItems.nodes;
  const totals = lines.map((l) => toCents(l.discountedTotalSet?.shopMoney.amount));
  const shipping = toCents(order.totalShippingPriceSet?.shopMoney.amount) ?? 0;
  const shippingParts = apportion(shipping, totals.map((t) => t ?? 0));
  return lines.map((l, i) => ({
    orderId: fromGid(order.id),
    lineId: fromGid(l.id),
    sku: l.sku || null,
    remoteListingId: l.product ? fromGid(l.product.id) : null,
    quantity: l.quantity,
    soldAt: new Date(order.createdAt),
    title: l.title,
    currency: l.discountedTotalSet?.shopMoney.currencyCode ?? null,
    priceCents: totals[i],
    shippingCents: shippingParts[i],
    feesCents: null,
  }));
}

const ORDERS = `
query RelisticOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {
    nodes {
      id createdAt cancelledAt displayFinancialStatus
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 100) {
        nodes { id sku title quantity product { id } discountedTotalSet { shopMoney { amount currencyCode } } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function fetchShopifySales(connection: Connection, since: Date): Promise<SaleLine[]> {
  const lines: SaleLine[] = [];
  let after: string | null = null;
  do {
    const data: { orders: { nodes: ShopifyOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await shopifyGraphql(connection, ORDERS, { query: `created_at:>='${since.toISOString()}'`, after });
    for (const order of data.orders.nodes) lines.push(...orderToSales(order));
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (after);
  return lines;
}

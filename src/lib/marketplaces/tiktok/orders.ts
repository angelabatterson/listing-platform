import type { Connection } from "@/db/schema";
import { apportion, toCents, type SaleLine } from "../orders";
import { tiktokFetch } from "./client";
import { TIKTOK_VERSION } from "./config";

export type TiktokOrder = {
  id: string;
  status: string;
  create_time: number;
  payment?: { currency?: string; shipping_fee?: string };
  line_items?: {
    id: string;
    product_id?: string;
    seller_sku?: string;
    product_name?: string;
    sale_price?: string;
    currency?: string;
    display_status?: string;
  }[];
};

const NOT_SOLD = new Set(["UNPAID", "CANCELLED"]);

// TikTok lists each unit sold as its own line. Its fees aren't reported on the order,
// and buyer details aren't saved.
export function orderToSales(order: TiktokOrder): SaleLine[] {
  if (NOT_SOLD.has(order.status)) return [];
  const lines = (order.line_items ?? []).filter((l) => l.display_status !== "CANCELLED");
  const prices = lines.map((l) => toCents(l.sale_price));
  const shipping = apportion(toCents(order.payment?.shipping_fee) ?? 0, prices.map((p) => p ?? 0));
  return lines.map((l, i) => ({
    orderId: order.id,
    lineId: l.id,
    sku: l.seller_sku || null,
    remoteListingId: l.product_id ?? null,
    quantity: 1,
    soldAt: new Date(order.create_time * 1000),
    title: l.product_name ?? null,
    currency: l.currency ?? order.payment?.currency ?? null,
    priceCents: prices[i],
    shippingCents: shipping[i],
    feesCents: null,
  }));
}

export async function fetchTiktokSales(connection: Connection, since: Date): Promise<SaleLine[]> {
  const lines: SaleLine[] = [];
  let pageToken: string | undefined;
  do {
    const data = await tiktokFetch<{ orders?: TiktokOrder[]; next_page_token?: string }>(
      connection,
      `/order/${TIKTOK_VERSION}/orders/search`,
      {
        query: { page_size: 50, sort_field: "create_time", sort_order: "ASC", page_token: pageToken },
        json: { create_time_ge: Math.floor(since.getTime() / 1000) },
      },
    );
    for (const order of data.orders ?? []) lines.push(...orderToSales(order));
    pageToken = data.next_page_token || undefined;
  } while (pageToken);
  return lines;
}

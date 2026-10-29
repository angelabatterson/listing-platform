import type { Connection } from "@/db/schema";
import { toCents, type SaleLine } from "../orders";
import { etsyFetch } from "./client";

type EtsyMoney = { amount: number; divisor: number; currency_code?: string };

export type EtsyReceipt = {
  receipt_id: number;
  created_timestamp?: number;
  status?: string;
  name?: string | null;
  buyer_user_id?: number | null;
  transactions?: {
    transaction_id: number;
    sku?: string | null;
    listing_id?: number | null;
    quantity?: number;
    title?: string | null;
    // Per unit.
    price?: EtsyMoney | null;
    shipping_cost?: EtsyMoney | null;
  }[];
};

const money = (m: EtsyMoney | null | undefined) => (m && m.divisor ? toCents(m.amount / m.divisor) : null);

// Etsy's API doesn't report the fees on an order, so they're estimated from its US
// rates: a 6.5% transaction fee and 3% + $0.25 payment processing on the item and
// shipping, plus the $0.20 listing fee.
const ETSY_FEE_RATE = 0.065 + 0.03;
const ETSY_ORDER_FEE_CENTS = 25;
const ETSY_LISTING_FEE_CENTS = 20;

export function receiptToSales(receipt: EtsyReceipt): SaleLine[] {
  if (receipt.status === "canceled") return [];
  return (receipt.transactions ?? []).map((t, i) => {
    const quantity = t.quantity ?? 1;
    const unit = money(t.price);
    const priceCents = unit === null ? null : unit * quantity;
    const shippingCents = money(t.shipping_cost);
    const feesCents =
      priceCents === null
        ? null
        : Math.round((priceCents + (shippingCents ?? 0)) * ETSY_FEE_RATE) +
          ETSY_LISTING_FEE_CENTS +
          (i === 0 ? ETSY_ORDER_FEE_CENTS : 0);
    return {
      orderId: String(receipt.receipt_id),
      lineId: String(t.transaction_id),
      sku: t.sku || null,
      remoteListingId: t.listing_id ? String(t.listing_id) : null,
      quantity,
      soldAt: receipt.created_timestamp ? new Date(receipt.created_timestamp * 1000) : new Date(),
      title: t.title ?? null,
      currency: t.price?.currency_code ?? null,
      priceCents,
      shippingCents,
      feesCents,
      feesEstimated: feesCents !== null,
      buyerId: receipt.buyer_user_id ? String(receipt.buyer_user_id) : null,
      buyerName: receipt.name || null,
    };
  });
}

// Paid receipts created since `since`.
export async function fetchEtsySales(connection: Connection, since: Date): Promise<SaleLine[]> {
  const shopId = connection.settings.shopId;
  const minCreated = Math.floor(since.getTime() / 1000);
  const lines: SaleLine[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await etsyFetch<{ count: number; results: EtsyReceipt[] }>(
      connection,
      `/v3/application/shops/${shopId}/receipts?min_created=${minCreated}&was_paid=true&limit=100&offset=${offset}`,
    );
    for (const receipt of page.results) lines.push(...receiptToSales(receipt));
    if (offset + 100 >= page.count) break;
  }
  return lines;
}

export async function fetchEtsyReceipt(connection: Connection, receiptId: string): Promise<EtsyReceipt> {
  return etsyFetch<EtsyReceipt>(
    connection,
    `/v3/application/shops/${connection.settings.shopId}/receipts/${encodeURIComponent(receiptId)}`,
  );
}

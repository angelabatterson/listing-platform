import type { Connection } from "@/db/schema";
import type { SaleLine } from "../orders";
import { etsyFetch } from "./client";

export type EtsyReceipt = {
  receipt_id: number;
  created_timestamp?: number;
  status?: string;
  transactions?: { transaction_id: number; sku?: string | null; listing_id?: number | null; quantity?: number }[];
};

export function receiptToSales(receipt: EtsyReceipt): SaleLine[] {
  if (receipt.status === "canceled") return [];
  return (receipt.transactions ?? []).map((t) => ({
    orderId: String(receipt.receipt_id),
    lineId: String(t.transaction_id),
    sku: t.sku || null,
    remoteListingId: t.listing_id ? String(t.listing_id) : null,
    quantity: t.quantity ?? 1,
    soldAt: receipt.created_timestamp ? new Date(receipt.created_timestamp * 1000) : new Date(),
  }));
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

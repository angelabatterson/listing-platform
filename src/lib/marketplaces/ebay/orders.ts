import type { Connection } from "@/db/schema";
import type { SaleLine } from "../orders";
import { ebayFetch } from "./client";

type EbayOrdersPage = {
  orders?: {
    orderId: string;
    creationDate: string;
    cancelStatus?: { cancelState?: string };
    lineItems: { lineItemId: string; sku?: string; legacyItemId?: string; quantity: number }[];
  }[];
  total?: number;
};

// Orders created since `since`, from the Sell Fulfillment API.
export async function fetchEbaySales(connection: Connection, since: Date): Promise<SaleLine[]> {
  const lines: SaleLine[] = [];
  const filter = encodeURIComponent(`creationdate:[${since.toISOString()}..]`);
  for (let offset = 0; ; offset += 200) {
    const page = await ebayFetch<EbayOrdersPage>(
      connection,
      `/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=${offset}`,
    );
    for (const order of page.orders ?? []) {
      if (order.cancelStatus?.cancelState === "CANCELED") continue;
      for (const line of order.lineItems) {
        lines.push({
          orderId: order.orderId,
          lineId: line.lineItemId,
          sku: line.sku ?? null,
          remoteListingId: line.legacyItemId ?? null,
          quantity: line.quantity,
          soldAt: new Date(order.creationDate),
        });
      }
    }
    if (offset + 200 >= (page.total ?? 0)) break;
  }
  return lines;
}

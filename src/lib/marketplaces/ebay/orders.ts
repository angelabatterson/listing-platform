import type { Connection } from "@/db/schema";
import { apportion, toCents, type SaleLine } from "../orders";
import { ebayFetch } from "./client";

type EbayAmount = { value?: string; currency?: string };

export type EbayOrder = {
  orderId: string;
  creationDate: string;
  cancelStatus?: { cancelState?: string };
  buyer?: { username?: string; buyerRegistrationAddress?: { fullName?: string } };
  totalMarketplaceFee?: EbayAmount;
  lineItems: {
    lineItemId: string;
    sku?: string;
    legacyItemId?: string;
    quantity: number;
    title?: string;
    lineItemCost?: EbayAmount;
    deliveryCost?: { shippingCost?: EbayAmount };
    appliedPromotions?: { discountAmount?: EbayAmount }[];
  }[];
};

type EbayOrdersPage = { orders?: EbayOrder[]; total?: number };

export function orderToSales(order: EbayOrder): SaleLine[] {
  if (order.cancelStatus?.cancelState === "CANCELED") return [];
  const prices = order.lineItems.map((line) => {
    const cost = toCents(line.lineItemCost?.value);
    if (cost === null) return null;
    const discount = (line.appliedPromotions ?? []).reduce((sum, p) => sum + (toCents(p.discountAmount?.value) ?? 0), 0);
    return cost - discount;
  });
  // eBay reports its fees for the whole order.
  const orderFees = toCents(order.totalMarketplaceFee?.value);
  const fees = orderFees === null ? null : apportion(orderFees, prices.map((p) => p ?? 0));

  return order.lineItems.map((line, i) => ({
    orderId: order.orderId,
    lineId: line.lineItemId,
    sku: line.sku ?? null,
    remoteListingId: line.legacyItemId ?? null,
    quantity: line.quantity,
    soldAt: new Date(order.creationDate),
    title: line.title ?? null,
    currency: line.lineItemCost?.currency ?? null,
    priceCents: prices[i],
    shippingCents: toCents(line.deliveryCost?.shippingCost?.value),
    feesCents: fees ? fees[i] : null,
    buyerId: order.buyer?.username ?? null,
    buyerName: order.buyer?.buyerRegistrationAddress?.fullName || order.buyer?.username || null,
  }));
}

// Orders created since `since`, from the Sell Fulfillment API.
export async function fetchEbaySales(connection: Connection, since: Date): Promise<SaleLine[]> {
  const lines: SaleLine[] = [];
  const filter = encodeURIComponent(`creationdate:[${since.toISOString()}..]`);
  for (let offset = 0; ; offset += 200) {
    const page = await ebayFetch<EbayOrdersPage>(
      connection,
      `/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=${offset}`,
    );
    for (const order of page.orders ?? []) lines.push(...orderToSales(order));
    if (offset + 200 >= (page.total ?? 0)) break;
  }
  return lines;
}

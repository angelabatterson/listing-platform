import type { Connection, PostalAddress } from "@/db/schema";
import { ebayFetch } from "@/lib/marketplaces/ebay/client";
import { etsyFetch } from "@/lib/marketplaces/etsy/client";
import type { EtsyReceipt } from "@/lib/marketplaces/etsy/orders";

// What's needed to ship one order, read fresh from the store so the buyer's
// address is never stored in Relistic.
export type OrderToShip = {
  shipTo: PostalAddress | null;
  shipped: boolean;
  lines: { lineItemId: string; quantity: number }[];
};

type EbayAddress = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
};

export type EbayOrderDetail = {
  orderFulfillmentStatus?: string;
  lineItems?: { lineItemId: string; quantity: number }[];
  fulfillmentStartInstructions?: {
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        companyName?: string;
        contactAddress?: EbayAddress;
        primaryPhone?: { phoneNumber?: string };
        email?: string;
      };
    };
  }[];
};

export function ebayOrderToShip(order: EbayOrderDetail): OrderToShip {
  const to = order.fulfillmentStartInstructions?.find((f) => f.shippingStep?.shipTo)?.shippingStep?.shipTo;
  const a = to?.contactAddress;
  return {
    shipTo:
      to && a?.addressLine1
        ? {
            name: to.fullName ?? "",
            company: to.companyName,
            street1: a.addressLine1,
            street2: a.addressLine2,
            city: a.city ?? "",
            state: a.stateOrProvince ?? "",
            zip: a.postalCode ?? "",
            country: a.countryCode ?? "US",
            phone: to.primaryPhone?.phoneNumber,
            email: to.email,
          }
        : null,
    shipped: order.orderFulfillmentStatus === "FULFILLED",
    lines: (order.lineItems ?? []).map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity })),
  };
}

type EtsyReceiptDetail = EtsyReceipt & {
  first_line?: string | null;
  second_line?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country_iso?: string | null;
  buyer_email?: string | null;
  is_shipped?: boolean;
};

export function etsyReceiptToShip(r: EtsyReceiptDetail): OrderToShip {
  return {
    shipTo: r.first_line
      ? {
          name: r.name ?? "",
          street1: r.first_line,
          street2: r.second_line ?? undefined,
          city: r.city ?? "",
          state: r.state ?? "",
          zip: r.zip ?? "",
          country: r.country_iso ?? "US",
          email: r.buyer_email ?? undefined,
        }
      : null,
    shipped: Boolean(r.is_shipped),
    lines: (r.transactions ?? []).map((t) => ({ lineItemId: String(t.transaction_id), quantity: t.quantity ?? 1 })),
  };
}

export async function fetchOrderToShip(connection: Connection, orderId: string): Promise<OrderToShip> {
  if (connection.marketplace === "ebay") {
    return ebayOrderToShip(
      await ebayFetch<EbayOrderDetail>(connection, `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`),
    );
  }
  return etsyReceiptToShip(
    await etsyFetch<EtsyReceiptDetail>(
      connection,
      `/v3/application/shops/${connection.settings.shopId}/receipts/${encodeURIComponent(orderId)}`,
    ),
  );
}

// Carrier names as each store expects them. Anything else goes to Etsy as "other".
const EBAY_CARRIERS: Record<string, string> = { USPS: "USPS", UPS: "UPS", FedEx: "FedEx", "DHL Express": "DHL" };
const ETSY_CARRIERS: Record<string, string> = { USPS: "usps", UPS: "ups", FedEx: "fedex", "DHL Express": "dhl" };

// Mark the order shipped on its store with the tracking number, which also lets the buyer know.
export async function sendTracking(
  connection: Connection,
  orderId: string,
  order: OrderToShip,
  carrier: string,
  trackingNumber: string,
): Promise<void> {
  if (connection.marketplace === "ebay") {
    await ebayFetch(connection, `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, {
      method: "POST",
      body: {
        lineItems: order.lines,
        shippedDate: new Date().toISOString(),
        shippingCarrierCode: EBAY_CARRIERS[carrier] ?? carrier,
        trackingNumber,
      },
    });
    return;
  }
  await etsyFetch(
    connection,
    `/v3/application/shops/${connection.settings.shopId}/receipts/${encodeURIComponent(orderId)}/tracking`,
    { method: "POST", body: { json: { tracking_code: trackingNumber, carrier_name: ETSY_CARRIERS[carrier] ?? "other" } } },
  );
}

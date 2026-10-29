import type { ParcelSize, PostalAddress } from "@/db/schema";
import { toCents } from "@/lib/marketplaces/orders";

const SHIPPO_API = "https://api.goshippo.com";

export class ShippoError extends Error {}

type ShippoMessage = { source?: string; code?: string; text?: string };

const messageText = (messages?: ShippoMessage[]) =>
  (messages ?? [])
    .map((m) => m.text)
    .filter(Boolean)
    .join(" ");

export const isTestToken = (token: string) => token.startsWith("shippo_test_");
export const looksLikeShippoToken = (token: string) => /^shippo_(test|live)_[A-Za-z0-9]+$/.test(token);

async function shippoFetch<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, SHIPPO_API), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `ShippoToken ${token}`,
      Accept: "application/json",
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (res.status === 401) throw new ShippoError("Shippo didn't accept the key. Check it in Shipping settings.");
  if (!res.ok) {
    const detail = (json as { detail?: string } | undefined)?.detail;
    throw new ShippoError(detail || `Shippo error ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return json as T;
}

// A cheap call that only succeeds with a working key.
export async function checkToken(token: string): Promise<void> {
  await shippoFetch(token, "/shipments/?results=1");
}

const toShippoAddress = (a: PostalAddress) => ({
  name: a.name,
  company: a.company || undefined,
  street1: a.street1,
  street2: a.street2 || undefined,
  city: a.city,
  state: a.state,
  zip: a.zip,
  country: a.country,
  phone: a.phone || undefined,
  email: a.email || undefined,
});

export type Rate = {
  id: string;
  carrier: string;
  service: string;
  costCents: number;
  currency: string;
  days: number | null;
};

type ShippoRate = {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel?: { name?: string };
  servicelevel_name?: string;
  estimated_days?: number | null;
};

const toRate = (r: ShippoRate): Rate => ({
  id: r.object_id,
  carrier: r.provider,
  service: r.servicelevel?.name ?? r.servicelevel_name ?? "",
  costCents: toCents(r.amount) ?? 0,
  currency: r.currency,
  days: r.estimated_days ?? null,
});

// Every rate the seller's carriers offer for this parcel, cheapest first.
export async function getRates(token: string, from: PostalAddress, to: PostalAddress, parcel: ParcelSize): Promise<Rate[]> {
  const shipment = await shippoFetch<{ status?: string; rates?: ShippoRate[]; messages?: ShippoMessage[] }>(
    token,
    "/shipments/",
    {
      address_from: toShippoAddress(from),
      address_to: toShippoAddress(to),
      parcels: [
        {
          length: String(parcel.lengthIn),
          width: String(parcel.widthIn),
          height: String(parcel.heightIn),
          distance_unit: "in",
          weight: String(parcel.weightOz),
          mass_unit: "oz",
        },
      ],
      async: false,
    },
  );
  const rates = (shipment.rates ?? []).map(toRate).sort((a, b) => a.costCents - b.costCents);
  if (rates.length === 0) {
    throw new ShippoError(messageText(shipment.messages) || "No carrier offered a rate for this parcel. Check the addresses and size.");
  }
  return rates;
}

export type Label = {
  id: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string;
  rate: Rate;
};

// Buy the label for a rate. Shippo charges the seller's own account.
export async function buyLabel(token: string, rateId: string): Promise<Label> {
  const rate = toRate(await shippoFetch<ShippoRate>(token, `/rates/${encodeURIComponent(rateId)}`));
  const tx = await shippoFetch<{
    object_id: string;
    status: string;
    tracking_number?: string | null;
    tracking_url_provider?: string | null;
    label_url?: string | null;
    messages?: ShippoMessage[];
  }>(token, "/transactions/", { rate: rateId, label_file_type: "PDF_4x6", async: false });
  if (tx.status !== "SUCCESS" || !tx.label_url) {
    throw new ShippoError(messageText(tx.messages) || `The label couldn't be bought (${tx.status}).`);
  }
  return {
    id: tx.object_id,
    trackingNumber: tx.tracking_number || null,
    trackingUrl: tx.tracking_url_provider || null,
    labelUrl: tx.label_url,
    rate,
  };
}

import type { Connection } from "@/db/schema";
import { decodeEntities, type ImportedListing } from "../imported";
import { etsyFetch } from "./client";

export type EtsyListing = {
  listing_id: number;
  title?: string;
  description?: string;
  quantity?: number;
  price?: { amount: number; divisor: number; currency_code?: string };
  skus?: string[];
  taxonomy_id?: number | null;
  when_made?: string | null;
  has_variations?: boolean;
  images?: { url_fullxfull?: string; rank?: number }[];
};

// Returns null for listings Relistic can't manage yet (ones with variations, whose
// separate prices and quantities would be lost).
export function fromEtsyListing(l: EtsyListing): ImportedListing | null {
  if (l.has_variations) return null;
  const photos = [...(l.images ?? [])]
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((i) => i.url_fullxfull)
    .filter((u): u is string => Boolean(u?.startsWith("https://")));
  return {
    remoteListingId: String(l.listing_id),
    sku: l.skus?.find((s) => s.trim())?.trim() || null,
    title: decodeEntities(l.title ?? "").trim() || `Etsy listing ${l.listing_id}`,
    description: decodeEntities(l.description ?? "").trim(),
    priceCents: l.price?.divisor ? Math.round((l.price.amount / l.price.divisor) * 100) : 0,
    currency: l.price?.currency_code ?? "USD",
    quantity: Math.max(0, l.quantity ?? 1),
    photos,
    overrides: {
      ...(l.taxonomy_id && { categoryId: String(l.taxonomy_id) }),
      ...(l.when_made && { whenMade: l.when_made }),
    },
  };
}

const PAGE_SIZE = 100;

// One page of the shop's active listings, with photos. `page` starts at 1.
export async function fetchActiveEtsyListings(connection: Connection, page: number) {
  const res = await etsyFetch<{ count: number; results?: EtsyListing[] }>(
    connection,
    `/v3/application/shops/${connection.settings.shopId}/listings?state=active&includes=Images&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );
  const items = res.results ?? [];
  return { items, total: res.count, done: page * PAGE_SIZE >= res.count || items.length === 0 };
}

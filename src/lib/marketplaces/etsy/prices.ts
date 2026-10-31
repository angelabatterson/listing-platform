import type { Connection } from "@/db/schema";
import { summarizeExamples, type PriceCheck } from "../ebay/browse";
import { etsyFetch } from "./client";

type ActiveListings = {
  results?: {
    title: string;
    url: string;
    price?: { amount: number; divisor: number; currency_code: string };
  }[];
};

export function summarizeEtsyListings(response: ActiveListings): PriceCheck | null {
  return summarizeExamples(
    (response.results ?? [])
      .filter((l) => l.price?.currency_code === "USD" && l.price.divisor > 0)
      .map((l) => ({
        title: l.title,
        priceCents: Math.round((l.price!.amount / l.price!.divisor) * 100),
        url: l.url,
      })),
  );
}

// Asking prices of similar active listings on Etsy right now. Etsy doesn't share sold prices.
export async function checkEtsyPrices(
  connection: Connection,
  options: { query: string; taxonomyId?: string },
): Promise<PriceCheck | null> {
  const params = new URLSearchParams({ keywords: options.query.slice(0, 100), limit: "50" });
  if (options.taxonomyId) params.set("taxonomy_id", options.taxonomyId);
  const response = await etsyFetch<ActiveListings>(connection, `/v3/application/listings/active?${params}`);
  return summarizeEtsyListings(response);
}

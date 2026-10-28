import type { Connection } from "@/db/schema";
import { ebayFetch } from "./client";
import { DEFAULT_MARKETPLACE_ID } from "./config";

export type PriceExample = { title: string; priceCents: number; url: string; imageUrl?: string; condition?: string };

export type PriceCheck = {
  count: number;
  lowCents: number;
  medianCents: number;
  highCents: number;
  examples: PriceExample[];
};

type SearchResponse = {
  itemSummaries?: {
    title: string;
    price?: { value: string; currency: string };
    itemWebUrl: string;
    condition?: string;
    image?: { imageUrl: string };
  }[];
};

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

// A typical range rather than the extremes: the middle half of asking prices.
export function summarizePrices(response: SearchResponse): PriceCheck | null {
  const examples: PriceExample[] = (response.itemSummaries ?? [])
    .filter((i) => i.price?.currency === "USD")
    .map((i) => ({
      title: i.title,
      priceCents: Math.round(Number(i.price!.value) * 100),
      url: i.itemWebUrl,
      imageUrl: i.image?.imageUrl,
      condition: i.condition,
    }))
    .filter((e) => e.priceCents > 0);
  if (examples.length === 0) return null;
  const prices = examples.map((e) => e.priceCents).sort((a, b) => a - b);
  return {
    count: prices.length,
    lowCents: quantile(prices, 0.25),
    medianCents: quantile(prices, 0.5),
    highCents: quantile(prices, 0.75),
    examples: examples.slice(0, 6),
  };
}

// Asking prices of similar fixed-price listings on eBay right now. (Sold prices
// need eBay's Marketplace Insights API, which eBay only grants by application.)
export async function checkEbayPrices(
  connection: Connection,
  options: { query: string; categoryId?: string; isNew: boolean },
): Promise<PriceCheck | null> {
  const params = new URLSearchParams({
    q: options.query.slice(0, 100),
    limit: "50",
    filter: `buyingOptions:{FIXED_PRICE},conditions:{${options.isNew ? "NEW" : "USED"}}`,
  });
  if (options.categoryId) params.set("category_ids", options.categoryId);
  const response = await ebayFetch<SearchResponse>(connection, `/buy/browse/v1/item_summary/search?${params}`, {
    headers: { "X-EBAY-C-MARKETPLACE-ID": connection.settings.marketplaceId ?? DEFAULT_MARKETPLACE_ID },
  });
  return summarizePrices(response);
}

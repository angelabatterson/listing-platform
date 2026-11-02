import { summarizeExamples, type PriceCheck } from "./browse";
import { DEFAULT_MARKETPLACE_ID, ebayEnvironment, ebayHosts, ebayIsConfigured } from "./config";
import { applicationToken } from "./oauth";

// Sold prices come from eBay's Marketplace Insights API, which eBay only opens to an app
// after an application. Until then eBay refuses the scope or the call, and Relistic says
// sold prices aren't available yet instead of failing.
export const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

export type SoldCheck = { available: false } | { available: true; check: PriceCheck | null };

type SalesResponse = {
  itemSales?: {
    title: string;
    lastSoldPrice?: { value: string; currency: string };
    itemWebUrl: string;
    condition?: string;
    image?: { imageUrl: string };
  }[];
};

export function summarizeSales(response: SalesResponse): PriceCheck | null {
  return summarizeExamples(
    (response.itemSales ?? [])
      .filter((s) => s.lastSoldPrice?.currency === "USD")
      .map((s) => ({
        title: s.title,
        priceCents: Math.round(Number(s.lastSoldPrice!.value) * 100),
        url: s.itemWebUrl,
        imageUrl: s.image?.imageUrl,
        condition: s.condition,
      })),
  );
}

// After eBay says no, don't ask again for an hour, so every price check isn't slowed down.
const RETRY_MS = 60 * 60 * 1000;
let refusedAt = 0;

export function resetSoldAccess() {
  refusedAt = 0;
}

function refused(): SoldCheck {
  refusedAt = Date.now();
  return { available: false };
}

// What similar items sold for on eBay in the last 90 days.
export async function checkEbaySoldPrices(options: { query: string; categoryId?: string; isNew: boolean }): Promise<SoldCheck> {
  if (!ebayIsConfigured() || ebayEnvironment() !== "production") return { available: false };
  if (Date.now() - refusedAt < RETRY_MS) return { available: false };

  let token: string;
  try {
    token = await applicationToken(INSIGHTS_SCOPE);
  } catch (err) {
    // eBay answers "invalid_scope" until the app is approved.
    if (err instanceof Error && /scope/i.test(err.message)) return refused();
    throw err;
  }
  const params = new URLSearchParams({
    q: options.query.slice(0, 100),
    limit: "50",
    filter: `conditions:{${options.isNew ? "NEW" : "USED"}}`,
  });
  if (options.categoryId) params.set("category_ids", options.categoryId);
  const res = await fetch(new URL(`/buy/marketplace_insights/v1_beta/item_sales/search?${params}`, ebayHosts().api), {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": DEFAULT_MARKETPLACE_ID, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) return refused();
  if (!res.ok) throw new Error(`eBay sold-price search failed (${res.status})`);
  return { available: true, check: summarizeSales((await res.json()) as SalesResponse) };
}

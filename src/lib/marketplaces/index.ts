import type { Connection } from "@/db/schema";
import { ebayAdapter } from "./ebay/adapter";
import type { MarketplaceAdapter } from "./types";

const adapters: Partial<Record<Connection["marketplace"], MarketplaceAdapter>> = {
  ebay: ebayAdapter,
};

export function adapterFor(marketplace: Connection["marketplace"]): MarketplaceAdapter {
  const adapter = adapters[marketplace];
  if (!adapter) throw new Error(`${marketplace} isn't supported yet`);
  return adapter;
}

export const MARKETPLACE_LABELS: Record<Connection["marketplace"], string> = {
  ebay: "eBay",
  etsy: "Etsy",
};

import type { Connection } from "@/db/schema";
import { ebayAdapter } from "./ebay/adapter";
import { etsyAdapter } from "./etsy/adapter";
import type { MarketplaceAdapter } from "./types";

const adapters: Partial<Record<Connection["marketplace"], MarketplaceAdapter>> = {
  ebay: ebayAdapter,
  etsy: etsyAdapter,
};

export function adapterFor(marketplace: Connection["marketplace"]): MarketplaceAdapter {
  const adapter = adapters[marketplace];
  if (!adapter) throw new Error(`${marketplace} isn't supported yet`);
  return adapter;
}

export { MARKETPLACE_LABELS } from "./labels";

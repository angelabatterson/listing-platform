import type { Connection } from "@/db/schema";
import { ebayAdapter } from "./ebay/adapter";
import { etsyAdapter } from "./etsy/adapter";
import type { MarketplaceAdapter } from "./types";
import { validateForExtension } from "@/lib/extension/tasks";

// The extension stores are posted by the seller's browser (see lib/extension), so their
// adapter only checks listings; the sync engine queues work instead of calling it.
const extensionAdapter: MarketplaceAdapter = {
  validate: validateForExtension,
  upsertListing: async () => {
    throw new Error("This store is posted through the Relistic extension.");
  },
  endListing: async () => {
    throw new Error("This store is taken down through the Relistic extension.");
  },
};

const adapters: Record<Connection["marketplace"], MarketplaceAdapter> = {
  ebay: ebayAdapter,
  etsy: etsyAdapter,
  poshmark: extensionAdapter,
  depop: extensionAdapter,
  facebook: extensionAdapter,
  mercari: extensionAdapter,
  whatnot: extensionAdapter,
};

export function adapterFor(marketplace: Connection["marketplace"]): MarketplaceAdapter {
  return adapters[marketplace];
}

export { MARKETPLACE_LABELS } from "./labels";

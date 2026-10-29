import type { Connection } from "@/db/schema";

export const MARKETPLACE_LABELS: Record<Connection["marketplace"], string> = {
  ebay: "eBay",
  etsy: "Etsy",
  shopify: "Shopify",
  tiktok: "TikTok Shop",
  poshmark: "Poshmark",
  depop: "Depop",
  facebook: "Facebook Marketplace",
  mercari: "Mercari",
  whatnot: "Whatnot",
  grailed: "Grailed",
};

// Stores worked through the Relistic Chrome extension rather than an API.
export const EXTENSION_MARKETPLACES = ["poshmark", "depop", "mercari", "grailed", "facebook", "whatnot"] as const;
export type ExtensionMarketplace = (typeof EXTENSION_MARKETPLACES)[number];

export function isExtensionMarketplace(m: Connection["marketplace"]): m is ExtensionMarketplace {
  return (EXTENSION_MARKETPLACES as readonly string[]).includes(m);
}

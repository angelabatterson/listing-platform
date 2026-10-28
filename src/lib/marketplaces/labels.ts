import type { Connection } from "@/db/schema";

export const MARKETPLACE_LABELS: Record<Connection["marketplace"], string> = {
  ebay: "eBay",
  etsy: "Etsy",
};

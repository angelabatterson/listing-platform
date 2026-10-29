// Shopify Admin GraphQL API version. Shopify supports each version for a year.
export const SHOPIFY_API_VERSION = "2026-07";

export const SHOPIFY_SCOPES = ["write_products", "read_inventory", "write_inventory", "read_locations", "read_orders"];

export const SHOPIFY_STATE_COOKIE = "lp_shopify_oauth";

export function shopifyCredentials() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Shopify keys are not configured (SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET)");
  }
  return { clientId, clientSecret };
}

export function shopifyIsConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}

export function shopifyRedirectUri(): string {
  return `${process.env.APP_URL}/api/shopify/oauth/callback`;
}

// Turn whatever the seller typed ("mystore", "mystore.myshopify.com",
// "https://mystore.myshopify.com/admin") into "mystore.myshopify.com", or null.
// Only *.myshopify.com addresses are accepted, so tokens are only ever sent to Shopify.
export function normalizeShopDomain(input: string | null | undefined): string | null {
  let s = (input ?? "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  if (/^[a-z0-9][a-z0-9-]*$/.test(s)) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

export type EbayEnvironment = "sandbox" | "production";

export function ebayEnvironment(): EbayEnvironment {
  return process.env.EBAY_ENV === "production" ? "production" : "sandbox";
}

export function ebayHosts(env: EbayEnvironment = ebayEnvironment()) {
  return env === "production"
    ? {
        auth: "https://auth.ebay.com",
        api: "https://api.ebay.com",
        apiz: "https://apiz.ebay.com",
        sellerHub: "https://www.ebay.com/sh/ovw",
        policies: "https://www.bizpolicy.ebay.com/businesspolicy/manage",
      }
    : {
        auth: "https://auth.sandbox.ebay.com",
        api: "https://api.sandbox.ebay.com",
        apiz: "https://apiz.sandbox.ebay.com",
        sellerHub: "https://sandbox.ebay.com",
        policies: "https://www.bizpolicy.sandbox.ebay.com/businesspolicy/manage",
      };
}

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

export const DEFAULT_MARKETPLACE_ID = "EBAY_US";

export function ebayCredentials() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RUNAME;
  if (!clientId || !clientSecret || !ruName) {
    throw new Error("eBay keys are not configured (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME)");
  }
  return { clientId, clientSecret, ruName };
}

export function ebayIsConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET && process.env.EBAY_RUNAME);
}

export const EBAY_STATE_COOKIE = "lp_ebay_oauth_state";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { OAuthTokens } from "../tokens";
import { SHOPIFY_SCOPES, shopifyCredentials, shopifyRedirectUri } from "./config";

export function buildAuthorizeUrl(shop: string, state: string): string {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", shopifyCredentials().clientId);
  url.searchParams.set("scope", SHOPIFY_SCOPES.join(","));
  url.searchParams.set("redirect_uri", shopifyRedirectUri());
  url.searchParams.set("state", state);
  return url.toString();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// Shopify signs the query string of its redirects: every parameter except `hmac`,
// sorted and joined as a query string, HMAC-SHA256 with the app's secret, in hex.
export function verifyShopifyQuery(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const expected = createHmac("sha256", secret).update(message).digest();
  return safeEqual(Buffer.from(hmac, "hex"), expected);
}

// Webhooks are signed over the raw body, base64.
export function verifyShopifyWebhook(rawBody: string, hmac: string | null, secret: string): boolean {
  if (!hmac) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return safeEqual(Buffer.from(hmac, "base64"), expected);
}

// An access token that never expires (Shopify's usual offline token) is stored with
// no expiry. If Shopify issues an expiring one, its refresh token is kept too.
export type ShopifyTokens = Omit<OAuthTokens, "accessTokenExpiresAt"> & { accessTokenExpiresAt?: Date };

async function tokenRequest(shop: string, body: Record<string, string>): Promise<ShopifyTokens> {
  const { clientId, clientSecret } = shopifyCredentials();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...body }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Shopify sometimes answers errors with HTML.
  }
  if (!res.ok || typeof json.access_token !== "string") {
    throw new Error(`Shopify token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  const now = Date.now();
  const expiresIn = Number(json.expires_in);
  const refreshExpiresIn = Number(json.refresh_token_expires_in);
  return {
    accessToken: json.access_token,
    accessTokenExpiresAt: expiresIn > 0 ? new Date(now + expiresIn * 1000) : undefined,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    refreshTokenExpiresAt: refreshExpiresIn > 0 ? new Date(now + refreshExpiresIn * 1000) : undefined,
  };
}

export function exchangeCode(shop: string, code: string): Promise<ShopifyTokens> {
  return tokenRequest(shop, { code });
}

export async function refreshAccessToken(shop: string, refreshToken: string): Promise<OAuthTokens> {
  const tokens = await tokenRequest(shop, { grant_type: "refresh_token", refresh_token: refreshToken });
  // An hour if Shopify didn't say, so it's simply refreshed again.
  return { ...tokens, accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000) };
}

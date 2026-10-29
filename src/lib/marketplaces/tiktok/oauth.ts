import type { OAuthTokens } from "../tokens";
import { TIKTOK_AUTH_API, TIKTOK_AUTHORIZE_URL, tiktokCredentials } from "./config";

// The app's service id is its App ID; TikTok sends the seller back to the redirect
// URL registered on the app in Partner Center.
export function buildAuthorizeUrl(state: string): string {
  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("service_id", tiktokCredentials().appId);
  url.searchParams.set("state", state);
  return url.toString();
}

export type TiktokTokens = OAuthTokens & { sellerName?: string };

async function tokenRequest(path: string, params: Record<string, string>): Promise<TiktokTokens> {
  const { appKey, appSecret } = tiktokCredentials();
  const url = new URL(path, TIKTOK_AUTH_API);
  for (const [k, v] of Object.entries({ app_key: appKey, app_secret: appSecret, ...params })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  const data = json?.data;
  if (!res.ok || json?.code !== 0 || !data?.access_token) {
    throw new Error(`TikTok Shop token request failed: ${json?.message ?? res.status}`);
  }
  // TikTok gives expiry times as Unix timestamps, not durations.
  return {
    accessToken: data.access_token,
    accessTokenExpiresAt: new Date(Number(data.access_token_expire_in) * 1000),
    refreshToken: data.refresh_token,
    refreshTokenExpiresAt: data.refresh_token_expire_in ? new Date(Number(data.refresh_token_expire_in) * 1000) : undefined,
    sellerName: data.seller_name || undefined,
  };
}

export function exchangeCode(code: string): Promise<TiktokTokens> {
  return tokenRequest("/api/v2/token/get", { auth_code: code, grant_type: "authorized_code" });
}

export function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  return tokenRequest("/api/v2/token/refresh", { refresh_token: refreshToken, grant_type: "refresh_token" });
}

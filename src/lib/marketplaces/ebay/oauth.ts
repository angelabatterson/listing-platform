import type { OAuthTokens } from "../tokens";
import { EBAY_SCOPES, ebayCredentials, ebayHosts } from "./config";

export function buildAuthorizeUrl(state: string): string {
  const { clientId, ruName } = ebayCredentials();
  const url = new URL("/oauth2/authorize", ebayHosts().auth);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", EBAY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<OAuthTokens> {
  const { clientId, clientSecret } = ebayCredentials();
  const res = await fetch(new URL("/identity/v1/oauth2/token", ebayHosts().api), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`eBay token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  const now = Date.now();
  return {
    accessToken: json.access_token,
    accessTokenExpiresAt: new Date(now + json.expires_in * 1000),
    refreshToken: json.refresh_token,
    refreshTokenExpiresAt: json.refresh_token_expires_in
      ? new Date(now + json.refresh_token_expires_in * 1000)
      : undefined,
  };
}

export function exchangeCode(code: string): Promise<OAuthTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: ebayCredentials().ruName,
  });
}

export function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES.join(" "),
  });
}

// An application token (no seller involved), for calls such as fetching eBay's
// notification signing keys. Kept in memory until shortly before it expires.
let appToken: { token: string; expiresAt: number } | null = null;

export async function applicationToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.token;
  const tokens = await tokenRequest({ grant_type: "client_credentials", scope: EBAY_SCOPES[0] });
  appToken = { token: tokens.accessToken, expiresAt: tokens.accessTokenExpiresAt.getTime() };
  return tokens.accessToken;
}

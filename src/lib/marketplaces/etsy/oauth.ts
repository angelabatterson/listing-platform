import { createHash } from "node:crypto";
import { randomToken } from "@/lib/crypto";
import type { OAuthTokens } from "../tokens";
import { ETSY_API, ETSY_AUTHORIZE_URL, ETSY_SCOPES, etsyCredentials, etsyRedirectUri } from "./config";

// Etsy requires PKCE: we keep the verifier and send its SHA-256 as the challenge.
export function createPkce() {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const url = new URL(ETSY_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", etsyCredentials().keystring);
  url.searchParams.set("redirect_uri", etsyRedirectUri());
  url.searchParams.set("scope", ETSY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<OAuthTokens> {
  const res = await fetch(new URL("/v3/public/oauth/token", ETSY_API), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: etsyCredentials().keystring, ...body }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Etsy token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  const now = Date.now();
  return {
    accessToken: json.access_token,
    accessTokenExpiresAt: new Date(now + json.expires_in * 1000),
    refreshToken: json.refresh_token,
    // Etsy refresh tokens last 90 days.
    refreshTokenExpiresAt: json.refresh_token ? new Date(now + 90 * 24 * 60 * 60 * 1000) : undefined,
  };
}

export function exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    redirect_uri: etsyRedirectUri(),
    code,
    code_verifier: codeVerifier,
  });
}

export function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

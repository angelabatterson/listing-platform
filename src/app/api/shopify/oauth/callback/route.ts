import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { fetchShopifyShop } from "@/lib/marketplaces/shopify/adapter";
import { normalizeShopDomain, SHOPIFY_STATE_COOKIE, shopifyCredentials } from "@/lib/marketplaces/shopify/config";
import { exchangeCode, verifyShopifyQuery } from "@/lib/marketplaces/shopify/oauth";

function readStateCookie(raw: string | undefined): { state?: string; shop?: string } {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const saved = readStateCookie(jar.get(SHOPIFY_STATE_COOKIE)?.value);
  jar.delete(SHOPIFY_STATE_COOKIE);

  const code = params.get("code");
  const shop = normalizeShopDomain(params.get("shop"));
  if (!code) redirect("/stores?error=shopify_declined");
  if (
    !saved.state ||
    params.get("state") !== saved.state ||
    !shop ||
    shop !== saved.shop ||
    !verifyShopifyQuery(params, shopifyCredentials().clientSecret)
  ) {
    redirect("/stores?error=shopify_state");
  }

  const tokens = await exchangeCode(shop, code);
  const values = {
    organizationId: user.organizationId,
    marketplace: "shopify" as const,
    environment: "production",
    externalAccountId: shop,
    accessTokenEnc: encrypt(tokens.accessToken),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
    refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
    settings: { shopDomain: shop },
    status: "active" as const,
  };
  const [connection] = await db
    .insert(connections)
    .values(values)
    .onConflictDoUpdate({ target: [connections.organizationId, connections.marketplace], set: values })
    .returning();

  try {
    const info = await fetchShopifyShop(connection);
    await db
      .update(connections)
      .set({ displayName: info.name, settings: { shopDomain: shop, locationId: info.locationId } })
      .where(eq(connections.id, connection.id));
  } catch {
    redirect("/stores?error=shopify_no_location");
  }

  redirect("/stores?connected=shopify");
}

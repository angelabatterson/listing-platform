import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { normalizeShopDomain, SHOPIFY_STATE_COOKIE } from "@/lib/marketplaces/shopify/config";
import { buildAuthorizeUrl } from "@/lib/marketplaces/shopify/oauth";

// Reached from the Stores page form (?shop=what the seller typed), or from Shopify
// itself when the app is installed there (?shop=...&hmac=...).
export async function GET(request: NextRequest) {
  await requireUser();
  const shop = normalizeShopDomain(request.nextUrl.searchParams.get("shop"));
  if (!shop) redirect("/stores?error=shopify_shop");
  const state = randomToken(16);
  (await cookies()).set(SHOPIFY_STATE_COOKIE, JSON.stringify({ state, shop }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  redirect(buildAuthorizeUrl(shop, state));
}

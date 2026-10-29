import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { shopifyCredentials, shopifyIsConfigured } from "@/lib/marketplaces/shopify/config";
import { verifyShopifyWebhook } from "@/lib/marketplaces/shopify/oauth";

// Shopify tells every app when it's uninstalled, plus three privacy webhooks every
// public app must answer. Relistic keeps no Shopify customer data, so the customer
// ones need nothing; uninstalling or erasing a shop drops its tokens.
export async function POST(request: NextRequest) {
  if (!shopifyIsConfigured()) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const rawBody = await request.text();
  if (!verifyShopifyWebhook(rawBody, request.headers.get("x-shopify-hmac-sha256"), shopifyCredentials().clientSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic");
  const shop = request.headers.get("x-shopify-shop-domain");
  if (shop && (topic === "app/uninstalled" || topic === "shop/redact")) {
    await db
      .update(connections)
      .set({ status: "disconnected", accessTokenEnc: null, accessTokenExpiresAt: null, refreshTokenEnc: null, refreshTokenExpiresAt: null })
      .where(and(eq(connections.marketplace, "shopify"), eq(connections.externalAccountId, shop)));
  }
  return new NextResponse(null, { status: 200 });
}

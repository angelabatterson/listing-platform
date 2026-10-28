import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { fetchEtsyShop } from "@/lib/marketplaces/etsy/adapter";
import { ETSY_STATE_COOKIE } from "@/lib/marketplaces/etsy/config";
import { exchangeCode } from "@/lib/marketplaces/etsy/oauth";

function readStateCookie(raw: string | undefined): { state?: string; verifier?: string } {
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
  const saved = readStateCookie(jar.get(ETSY_STATE_COOKIE)?.value);
  jar.delete(ETSY_STATE_COOKIE);

  const code = params.get("code");
  if (!code) redirect("/stores?error=etsy_declined");
  if (!saved.state || !saved.verifier || params.get("state") !== saved.state) redirect("/stores?error=etsy_state");

  const tokens = await exchangeCode(code, saved.verifier);
  const values = {
    organizationId: user.organizationId,
    marketplace: "etsy" as const,
    environment: "production",
    accessTokenEnc: encrypt(tokens.accessToken),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
    status: "active" as const,
  };
  const [connection] = await db
    .insert(connections)
    .values(values)
    .onConflictDoUpdate({ target: [connections.organizationId, connections.marketplace], set: values })
    .returning();

  try {
    const shop = await fetchEtsyShop(connection);
    await db
      .update(connections)
      .set({
        externalAccountId: shop.shopId,
        displayName: shop.shopName,
        settings: { ...connection.settings, shopId: shop.shopId },
      })
      .where(eq(connections.id, connection.id));
  } catch {
    redirect("/stores?error=etsy_no_shop");
  }

  redirect("/stores?connected=etsy");
}

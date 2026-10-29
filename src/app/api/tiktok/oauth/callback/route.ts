import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { fetchTiktokShop } from "@/lib/marketplaces/tiktok/adapter";
import { TIKTOK_STATE_COOKIE } from "@/lib/marketplaces/tiktok/config";
import { exchangeCode } from "@/lib/marketplaces/tiktok/oauth";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const saved = jar.get(TIKTOK_STATE_COOKIE)?.value;
  jar.delete(TIKTOK_STATE_COOKIE);

  const code = params.get("code");
  if (!code) redirect("/stores?error=tiktok_declined");
  if (!saved || params.get("state") !== saved) redirect("/stores?error=tiktok_state");

  const tokens = await exchangeCode(code);
  const values = {
    organizationId: user.organizationId,
    marketplace: "tiktok" as const,
    environment: "production",
    displayName: tokens.sellerName ?? null,
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
    const { shopName, ...shop } = await fetchTiktokShop(connection);
    await db
      .update(connections)
      .set({ externalAccountId: shop.tiktokShopId, displayName: shopName, settings: { ...connection.settings, ...shop } })
      .where(eq(connections.id, connection.id));
  } catch {
    redirect("/stores?error=tiktok_no_shop");
  }

  redirect("/stores?connected=tiktok");
}

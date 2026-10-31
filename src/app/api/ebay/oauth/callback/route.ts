import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { fetchEbayUser, optInToBusinessPolicies } from "@/lib/marketplaces/ebay/adapter";
import { DEFAULT_MARKETPLACE_ID, EBAY_STATE_COOKIE, ebayEnvironment } from "@/lib/marketplaces/ebay/config";
import { exchangeCode } from "@/lib/marketplaces/ebay/oauth";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const expectedState = jar.get(EBAY_STATE_COOKIE)?.value;
  jar.delete(EBAY_STATE_COOKIE);

  const code = params.get("code");
  if (!code) redirect("/stores?error=ebay_declined");
  if (!expectedState || params.get("state") !== expectedState) redirect("/stores?error=ebay_state");

  const tokens = await exchangeCode(code);
  // A connection left from eBay's test environment holds test listings and sales that
  // mean nothing to the real eBay, so it goes rather than being reused.
  await db
    .delete(connections)
    .where(
      and(
        eq(connections.organizationId, user.organizationId),
        eq(connections.marketplace, "ebay"),
        ne(connections.environment, ebayEnvironment()),
      ),
    );
  const values = {
    organizationId: user.organizationId,
    marketplace: "ebay" as const,
    environment: ebayEnvironment(),
    accessTokenEnc: encrypt(tokens.accessToken),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
    status: "active" as const,
  };
  const [connection] = await db
    .insert(connections)
    .values({ ...values, settings: { marketplaceId: DEFAULT_MARKETPLACE_ID } })
    .onConflictDoUpdate({ target: [connections.organizationId, connections.marketplace], set: values })
    .returning();

  try {
    const ebayUser = await fetchEbayUser(connection);
    await db
      .update(connections)
      .set({ externalAccountId: ebayUser.userId, displayName: ebayUser.username })
      .where(eq(connections.id, connection.id));
  } catch {
    // The username is only for display; the connection works without it.
  }
  await optInToBusinessPolicies(connection);

  redirect("/stores?connected=ebay");
}

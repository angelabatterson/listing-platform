import { eq } from "drizzle-orm";
import { db } from "@/db";
import { connections, type Connection } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { MARKETPLACE_LABELS } from "./labels";

export type OAuthTokens = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
};

// Return a usable access token, refreshing it a minute early so it never expires
// mid-request. A failed refresh marks the store as needing to be reconnected.
export async function accessTokenFor(
  connection: Connection,
  refresh: (refreshToken: string) => Promise<OAuthTokens>,
): Promise<string> {
  if (connection.accessTokenExpiresAt.getTime() - Date.now() > 60_000) {
    return decrypt(connection.accessTokenEnc);
  }
  const label = MARKETPLACE_LABELS[connection.marketplace];
  if (!connection.refreshTokenEnc) throw new Error(`Reconnect your ${label} store.`);
  try {
    const tokens = await refresh(decrypt(connection.refreshTokenEnc));
    const update = {
      accessTokenEnc: encrypt(tokens.accessToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      // Etsy issues a new refresh token on every refresh; eBay keeps the old one.
      ...(tokens.refreshToken && {
        refreshTokenEnc: encrypt(tokens.refreshToken),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      }),
      status: "active" as const,
    };
    await db.update(connections).set(update).where(eq(connections.id, connection.id));
    Object.assign(connection, update);
    return tokens.accessToken;
  } catch (err) {
    await db.update(connections).set({ status: "needs_reauth" }).where(eq(connections.id, connection.id));
    throw err;
  }
}

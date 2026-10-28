import { eq } from "drizzle-orm";
import { db } from "@/db";
import { connections, type Connection } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { ebayHosts } from "./config";
import { refreshAccessToken } from "./oauth";

export class EbayApiError extends Error {
  constructor(
    public status: number,
    public errors: { errorId?: number; message?: string; longMessage?: string }[],
  ) {
    super(errors.map((e) => e.longMessage ?? e.message).filter(Boolean).join("; ") || `eBay API error ${status}`);
  }

  hasErrorId(id: number) {
    return this.errors.some((e) => e.errorId === id);
  }
}

// Refresh a minute early so a token never expires mid-request.
async function accessTokenFor(connection: Connection): Promise<string> {
  if (connection.accessTokenExpiresAt.getTime() - Date.now() > 60_000) {
    return decrypt(connection.accessTokenEnc);
  }
  if (!connection.refreshTokenEnc) throw new Error("eBay connection has no refresh token; reconnect the store");
  try {
    const tokens = await refreshAccessToken(decrypt(connection.refreshTokenEnc));
    await db
      .update(connections)
      .set({
        accessTokenEnc: encrypt(tokens.accessToken),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        status: "active",
      })
      .where(eq(connections.id, connection.id));
    connection.accessTokenEnc = encrypt(tokens.accessToken);
    connection.accessTokenExpiresAt = tokens.accessTokenExpiresAt;
    return tokens.accessToken;
  } catch (err) {
    await db.update(connections).set({ status: "needs_reauth" }).where(eq(connections.id, connection.id));
    throw err;
  }
}

export async function ebayFetch<T = unknown>(
  connection: Connection,
  path: string,
  init: { method?: string; body?: unknown; host?: "api" | "apiz" } = {},
): Promise<T> {
  const token = await accessTokenFor(connection);
  const res = await fetch(new URL(path, ebayHosts()[init.host ?? "api"]), {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      Accept: "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new EbayApiError(res.status, json?.errors ?? []);
  return json as T;
}

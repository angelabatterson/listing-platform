import { createHmac } from "node:crypto";
import type { Connection } from "@/db/schema";
import { accessTokenFor } from "../tokens";
import { TIKTOK_API, tiktokCredentials } from "./config";
import { refreshAccessToken } from "./oauth";

export class TiktokApiError extends Error {
  constructor(public code: number, message: string) {
    super(message || `TikTok Shop API error ${code}`);
  }
}

// TikTok Shop's request signature: the path, then every query parameter except `sign`
// and `access_token` sorted by name as name+value, then the body (unless it's a file
// upload), wrapped in the app secret on both sides and HMAC-SHA256'd with it, in hex.
export function signRequest(path: string, query: Record<string, string>, body: string, secret: string): string {
  const params = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");
  return createHmac("sha256", secret).update(`${secret}${path}${params}${body}${secret}`).digest("hex");
}

type Options = {
  method?: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  multipart?: FormData;
  // Most calls act on one shop; the shop list itself doesn't.
  withShop?: boolean;
};

export async function tiktokFetch<T = unknown>(connection: Connection, path: string, options: Options = {}): Promise<T> {
  const token = await accessTokenFor(connection, refreshAccessToken);
  const { appKey, appSecret } = tiktokCredentials();
  const query: Record<string, string> = { app_key: appKey, timestamp: String(Math.floor(Date.now() / 1000)) };
  if (options.withShop !== false) {
    const cipher = connection.settings.shopCipher;
    if (!cipher) throw new Error("Reconnect your TikTok Shop.");
    query.shop_cipher = cipher;
  }
  for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) query[k] = String(v);
  const body = options.json !== undefined ? JSON.stringify(options.json) : undefined;
  query.sign = signRequest(path, query, body ?? "", appSecret);

  const url = new URL(path, TIKTOK_API);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: options.method ?? (body || options.multipart ? "POST" : "GET"),
    headers: { "x-tts-access-token": token, ...(body && { "Content-Type": "application/json" }) },
    body: body ?? options.multipart,
  });
  const json = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: T } | null;
  if (!json || json.code !== 0) {
    throw new TiktokApiError(json?.code ?? res.status, json?.message ?? `TikTok Shop API error ${res.status}`);
  }
  return json.data as T;
}

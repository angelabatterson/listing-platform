import type { Connection } from "@/db/schema";
import { accessTokenFor } from "../tokens";
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

export async function ebayFetch<T = unknown>(
  connection: Connection,
  path: string,
  init: { method?: string; body?: unknown; host?: "api" | "apiz"; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = await accessTokenFor(connection, refreshAccessToken);
  const res = await fetch(new URL(path, ebayHosts()[init.host ?? "api"]), {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      Accept: "application/json",
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new EbayApiError(res.status, json?.errors ?? []);
  return json as T;
}

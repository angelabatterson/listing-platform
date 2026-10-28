import type { Connection } from "@/db/schema";
import { accessTokenFor } from "../tokens";
import { ETSY_API, etsyCredentials } from "./config";
import { refreshAccessToken } from "./oauth";

export class EtsyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message || `Etsy API error ${status}`);
  }
}

type Body =
  | { form: Record<string, string | number | boolean | undefined> }
  | { json: unknown }
  | { multipart: FormData };

function encodeBody(body?: Body): { body?: BodyInit; contentType?: string } {
  if (!body) return {};
  if ("form" in body) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body.form)) if (v !== undefined) params.set(k, String(v));
    return { body: params, contentType: "application/x-www-form-urlencoded" };
  }
  if ("json" in body) return { body: JSON.stringify(body.json), contentType: "application/json" };
  // fetch sets the multipart boundary itself.
  return { body: body.multipart };
}

export async function etsyFetch<T = unknown>(
  connection: Connection,
  path: string,
  init: { method?: string; body?: Body } = {},
): Promise<T> {
  const token = await accessTokenFor(connection, refreshAccessToken);
  const { keystring, sharedSecret } = etsyCredentials();
  const { body, contentType } = encodeBody(init.body);
  const res = await fetch(new URL(path, ETSY_API), {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": `${keystring}:${sharedSecret}`,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(contentType && { "Content-Type": contentType }),
    },
    body,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new EtsyApiError(res.status, json?.error ?? text);
  return json as T;
}

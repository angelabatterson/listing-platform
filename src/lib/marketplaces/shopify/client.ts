import type { Connection } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { accessTokenFor } from "../tokens";
import { SHOPIFY_API_VERSION } from "./config";
import { refreshAccessToken } from "./oauth";

export class ShopifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message || `Shopify API error ${status}`);
  }
}

async function tokenFor(connection: Connection): Promise<string> {
  const shop = connection.settings.shopDomain;
  if (!shop || !connection.accessTokenEnc) throw new Error("Reconnect your Shopify store.");
  // Shopify's usual offline tokens don't expire.
  if (!connection.accessTokenExpiresAt) return decrypt(connection.accessTokenEnc);
  return accessTokenFor(connection, (refreshToken) => refreshAccessToken(shop, refreshToken));
}

export async function shopifyGraphql<T>(
  connection: Connection,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = await tokenFor(connection);
  const res = await fetch(`https://${connection.settings.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json: { data?: T; errors?: { message: string }[] | string } | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // Not JSON: reported below with the status.
  }
  if (res.status === 401) throw new ShopifyApiError(401, "Shopify didn't accept Relistic's access. Reconnect your Shopify store.");
  if (!res.ok || !json?.data) {
    const errors = json?.errors;
    const message = typeof errors === "string" ? errors : errors?.map((e) => e.message).join(" ");
    throw new ShopifyApiError(res.status, message || `Shopify API error ${res.status}`);
  }
  return json.data;
}

type UserError = { field?: string[] | null; message: string };

// Mutations report problems with the input as userErrors rather than failing.
export function throwUserErrors(errors: UserError[] | undefined) {
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(" "));
}

export const toGid = (type: string, id: string) => (id.startsWith("gid://") ? id : `gid://shopify/${type}/${id}`);
export const fromGid = (gid: string) => gid.split("/").pop() ?? gid;

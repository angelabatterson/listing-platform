import { verify } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { buyerNotes, connections, sales } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import { ebayHosts } from "./config";
import { applicationToken } from "./oauth";

// eBay verifies the endpoint by sending ?challenge_code=... and expecting
// SHA-256(challengeCode + verificationToken + endpointUrl) back, hex-encoded.
export function challengeResponse(challengeCode: string, verificationToken: string, endpointUrl: string) {
  return sha256Hex(challengeCode + verificationToken + endpointUrl);
}

type SignatureHeader = { alg?: string; kid?: string; signature?: string; digest?: string };

export function parseSignatureHeader(header: string | null): SignatureHeader | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// eBay sends the key as one line; Node wants the base64 body on its own lines.
export function toPem(key: string): string {
  const body = key
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

export function signatureMatches(rawBody: string, signature: string, publicKey: string, digest = "SHA1"): boolean {
  try {
    return verify(digest.toLowerCase(), Buffer.from(rawBody), toPem(publicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

const keyCache = new Map<string, { key: string; digest: string }>();

async function publicKey(kid: string) {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const res = await fetch(new URL(`/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, ebayHosts().api), {
    headers: { Authorization: `Bearer ${await applicationToken()}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`eBay public key request failed: ${res.status}`);
  const json = (await res.json()) as { key: string; digest?: string };
  const entry = { key: json.key, digest: json.digest ?? "SHA1" };
  keyCache.set(kid, entry);
  return entry;
}

// True when the notice really came from eBay (signed with one of eBay's keys).
export async function isFromEbay(rawBody: string, header: string | null): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (!parsed?.kid || !parsed.signature) return false;
  const { key, digest } = await publicKey(parsed.kid);
  return signatureMatches(rawBody, parsed.signature, key, digest);
}

// Removes what Relistic holds about a closed eBay account: the buyer's username and
// name on sales, the seller's notes about them, and the store link if it was a seller.
export async function forgetEbayUser(user: { username?: string; userId?: string }) {
  const ebayConnections = db.select({ id: connections.id }).from(connections).where(eq(connections.marketplace, "ebay"));
  if (user.username) {
    await db
      .update(sales)
      .set({ buyerId: null, buyerName: null })
      .where(and(eq(sales.buyerId, user.username), inArray(sales.connectionId, ebayConnections)));
    await db.delete(buyerNotes).where(and(eq(buyerNotes.marketplace, "ebay"), eq(buyerNotes.buyerId, user.username)));
  }
  if (user.userId) {
    await db
      .delete(connections)
      .where(and(eq(connections.marketplace, "ebay"), eq(connections.externalAccountId, user.userId)));
  }
}

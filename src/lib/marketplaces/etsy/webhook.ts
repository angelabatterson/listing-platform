import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 5 * 60;

// Etsy signs "<webhook-id>.<webhook-timestamp>.<raw body>" with HMAC-SHA256, keyed by the
// endpoint's signing secret (base64 after the "whsec_" prefix). The signature header
// can hold several space-separated signatures, each optionally prefixed "v1,".
export function verifyEtsyWebhook(
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > MAX_AGE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some((entry) => {
    const candidate = Buffer.from(entry.replace(/^v1,/, ""), "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

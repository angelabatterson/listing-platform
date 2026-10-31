import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSignatureHeader, signatureMatches, toPem } from "@/lib/marketplaces/ebay/account-deletion";
import { ebayFetch } from "@/lib/marketplaces/ebay/client";
import { makeConnection } from "./fixtures";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
// eBay's key arrives as a single line, header and footer included.
const oneLineKey = publicKey.export({ type: "spki", format: "pem" }).toString().replace(/\n/g, "");
const body = JSON.stringify({ notification: { data: { username: "buyer1", userId: "u1" } } });
const signature = sign("sha1", Buffer.from(body), privateKey).toString("base64");

describe("eBay account deletion notices", () => {
  it("reads the signature header", () => {
    const header = Buffer.from(JSON.stringify({ alg: "ECDSA", kid: "k1", signature: "abc", digest: "SHA1" })).toString("base64");
    expect(parseSignatureHeader(header)).toMatchObject({ kid: "k1", signature: "abc" });
    expect(parseSignatureHeader("not base64 json")).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
  });

  it("turns eBay's one-line key into a PEM Node can read", () => {
    expect(toPem(oneLineKey)).toMatch(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n$/);
  });

  it("accepts a notice signed by the key and rejects a changed one", () => {
    expect(signatureMatches(body, signature, oneLineKey, "SHA1")).toBe(true);
    expect(signatureMatches(body.replace("buyer1", "buyer2"), signature, oneLineKey, "SHA1")).toBe(false);
    expect(signatureMatches(body, "garbage", oneLineKey, "SHA1")).toBe(false);
  });
});

describe("eBay environment switch", () => {
  it("refuses a connection made in the other eBay environment", async () => {
    await expect(ebayFetch(makeConnection({ environment: "production" }), "/sell/account/v1/privilege")).rejects.toThrow(
      /Reconnect eBay/,
    );
  });
});

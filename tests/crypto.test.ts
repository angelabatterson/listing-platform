import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashPassword, verifyPassword } from "@/lib/crypto";
import { challengeResponse } from "@/lib/marketplaces/ebay/account-deletion";

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("secret-token");
    const b = encrypt("secret-token");
    expect(a).not.toEqual(b);
    expect(decrypt(a)).toBe("secret-token");
  });

  it("rejects tampered ciphertext", () => {
    const [iv, tag, data] = encrypt("secret-token").split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });
});

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});

describe("eBay account deletion challenge", () => {
  it("hashes code + token + endpoint", () => {
    expect(challengeResponse("abc", "token", "https://x.test/hook")).toMatch(/^[0-9a-f]{64}$/);
    expect(challengeResponse("abc", "token", "https://x.test/hook")).not.toEqual(
      challengeResponse("abd", "token", "https://x.test/hook"),
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, encryptionKey, hashPassword, verifyPassword } from "@/lib/crypto";
import { challengeResponse } from "@/lib/marketplaces/ebay/account-deletion";

describe("encryption key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a base64 key as is", () => {
    const raw = Buffer.alloc(32, 9);
    vi.stubEnv("ENCRYPTION_KEY", raw.toString("base64"));
    expect(encryptionKey()).toEqual(raw);
  });

  it("turns a long password into a 32-byte key", () => {
    vi.stubEnv("ENCRYPTION_KEY", "correct horse battery staple and more words");
    expect(encryptionKey()).toHaveLength(32);
    expect(decrypt(encrypt("x"))).toBe("x");
  });

  it("refuses a short password", () => {
    vi.stubEnv("ENCRYPTION_KEY", "too-short");
    expect(() => encryptionKey()).toThrow("at least 32 characters");
  });
});

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

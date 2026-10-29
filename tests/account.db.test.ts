import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { organizations, sessions, users } from "@/db/schema";
import { hashPassword, sha256Hex, verifyPassword } from "@/lib/crypto";

const user = { id: "", organizationId: "", email: "seller@example.com", name: null as string | null };
const cookieToken = "this-browser";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: cookieToken }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireUser: async () => user,
}));

const { changeEmail, changePassword, saveProfile } = await import("@/app/(app)/account/actions");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("account settings", () => {
  beforeEach(async () => {
    await db.delete(organizations);
    const [org] = await db.insert(organizations).values({ name: "Old name" }).returning();
    const [row] = await db
      .insert(users)
      .values({ organizationId: org.id, email: user.email, passwordHash: await hashPassword("old-password-1") })
      .returning();
    Object.assign(user, { id: row.id, organizationId: org.id });
    const later = new Date(Date.now() + 86_400_000);
    await db.insert(sessions).values([
      { id: sha256Hex(cookieToken), userId: row.id, expiresAt: later },
      { id: sha256Hex("other-device"), userId: row.id, expiresAt: later },
    ]);
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  it("saves the business name and the user's name", async () => {
    expect(await saveProfile(undefined, form({ businessName: "Vintage Finds", name: "Sam" }))).toEqual({ saved: "Saved." });
    expect((await db.query.organizations.findFirst())?.name).toBe("Vintage Finds");
    expect((await db.query.users.findFirst())?.name).toBe("Sam");
    expect((await saveProfile(undefined, form({ businessName: " ", name: "" })))?.error).toMatch(/business name/);
  });

  it("changes the email only with the right password and when it's free", async () => {
    expect((await changeEmail(undefined, form({ email: "new@example.com", password: "wrong" })))?.error).toMatch(/password/);
    const [org2] = await db.insert(organizations).values({ name: "Other" }).returning();
    await db.insert(users).values({ organizationId: org2.id, email: "taken@example.com", passwordHash: "x" });
    expect((await changeEmail(undefined, form({ email: "Taken@example.com", password: "old-password-1" })))?.error).toMatch(
      /already uses/,
    );
    expect((await changeEmail(undefined, form({ email: "New@Example.com", password: "old-password-1" })))?.saved).toBeDefined();
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.email).toBe("new@example.com");
  });

  it("changes the password and logs out other devices", async () => {
    const bad = await changePassword(undefined, form({ current: "wrong", password: "new-password-1", confirm: "new-password-1" }));
    expect(bad?.error).toMatch(/current password/);
    const mismatch = await changePassword(undefined, form({ current: "old-password-1", password: "new-password-1", confirm: "other" }));
    expect(mismatch?.error).toMatch(/don't match/);

    const ok = await changePassword(undefined, form({ current: "old-password-1", password: "new-password-1", confirm: "new-password-1" }));
    expect(ok?.saved).toBeDefined();
    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(await verifyPassword("new-password-1", row!.passwordHash)).toBe(true);
    const left = await db.query.sessions.findMany({ where: eq(sessions.userId, user.id) });
    expect(left.map((s) => s.id)).toEqual([sha256Hex(cookieToken)]);
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { organizations, sessions, teamInvites, users } from "@/db/schema";
import { PLANS, type Access } from "@/lib/billing/plans";
import { hashPassword } from "@/lib/crypto";
import { canUse, cleanPages, homeFor } from "@/lib/team";

const owner = { id: "", organizationId: "", email: "owner@example.com", name: null as string | null, role: "owner", pages: [] as string[] };
const setCookie = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: setCookie }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireUser: async () => owner,
}));
let seats: number | null = 2;
vi.mock("@/lib/billing/access", () => ({
  getAccess: async (): Promise<Access> => ({
    state: "active",
    canWrite: true,
    plan: "pro",
    limits: { ...PLANS.pro.limits, teamSeats: seats },
    trialEndsAt: new Date(),
    subscribedBefore: true,
  }),
}));

const { cancelInvite, inviteHelper, newInviteLink, removeHelper, saveHelperPages } = await import("@/app/(app)/team/actions");
const { acceptInvite } = await import("@/app/(auth)/actions");

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) f.append(k, one);
  return f;
};
const tokenOf = (link?: string) => link?.split("/join/")[1] ?? "";

describe("team pages", () => {
  it("lets owners use everything and helpers only their pages", () => {
    const helper = { role: "helper", pages: ["sales", "items"] };
    expect(canUse({}, "owner")).toBe(true);
    expect(canUse(helper, "sales")).toBe(true);
    expect(canUse(helper, "crm")).toBe(false);
    expect(canUse(helper, "owner")).toBe(false);
    expect(homeFor(helper)).toBe("/items");
    expect(homeFor({ role: "helper", pages: [] })).toBe("/account");
    expect(cleanPages(["sales", "bogus", "items", "sales"])).toEqual(["items", "sales"]);
  });
});

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("team logins", () => {
  beforeEach(async () => {
    seats = 2;
    setCookie.mockClear();
    await db.delete(organizations);
    const [org] = await db.insert(organizations).values({ name: "Vintage Finds" }).returning();
    const [row] = await db
      .insert(users)
      .values({ organizationId: org.id, email: owner.email, passwordHash: await hashPassword("owner-password-1") })
      .returning();
    Object.assign(owner, { id: row.id, organizationId: org.id });
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  it("invites a helper who joins with only the pages they were given", async () => {
    const made = await inviteHelper(undefined, form({ email: " Helper@Example.com ", pages: ["batches", "nope", "items"] }));
    expect(made?.email).toBe("helper@example.com");
    const token = tokenOf(made?.link);
    expect(token).not.toBe("");
    // Only a hash of the link is kept.
    const [invite] = await db.select().from(teamInvites);
    expect(invite.tokenHash).not.toContain(token);
    expect(invite.pages).toEqual(["items", "batches"]);

    await expect(acceptInvite(token, undefined, form({ name: "Pat", password: "helper-password" }))).rejects.toThrow("redirect:/items");
    const helper = await db.query.users.findFirst({ where: eq(users.email, "helper@example.com") });
    expect(helper).toMatchObject({ organizationId: owner.organizationId, role: "helper", name: "Pat", pages: ["items", "batches"] });
    expect(await db.select().from(teamInvites)).toEqual([]);
    expect(setCookie).toHaveBeenCalled();
    // A used link doesn't work again.
    expect(await acceptInvite(token, undefined, form({ name: "Pat", password: "helper-password" }))).toEqual({
      error: "This invite link has expired or was cancelled. Ask for a new one.",
    });
  });

  it("needs a page, a free seat and an email that isn't taken", async () => {
    expect(await inviteHelper(undefined, form({ email: "a@example.com" }))).toEqual({ error: "Tick at least one page your helper can use." });
    expect((await inviteHelper(undefined, form({ email: owner.email, pages: "items" })))?.error).toContain("already has a Relistic login");
    await inviteHelper(undefined, form({ email: "a@example.com", pages: "items" }));
    await inviteHelper(undefined, form({ email: "b@example.com", pages: "items" }));
    // Two invites fill a Pro plan.
    expect((await inviteHelper(undefined, form({ email: "c@example.com", pages: "items" })))?.error).toContain("all in use");
    seats = 0;
    expect((await inviteHelper(undefined, form({ email: "c@example.com", pages: "items" })))?.error).toContain("Pro and Business");
    seats = null;
    expect((await inviteHelper(undefined, form({ email: "c@example.com", pages: "items" })))?.link).toBeTruthy();
  });

  it("replaces lost links, cancels invites, changes pages and removes helpers", async () => {
    const first = await inviteHelper(undefined, form({ email: "h@example.com", pages: "sales" }));
    const [invite] = await db.select().from(teamInvites);
    const again = await newInviteLink(invite.id);
    expect(again?.link).not.toBe(first?.link);
    expect(await acceptInvite(tokenOf(first?.link), undefined, form({ name: "H", password: "helper-password" }))).toMatchObject({
      error: expect.stringContaining("expired"),
    });
    await cancelInvite(invite.id);
    expect(await db.select().from(teamInvites)).toEqual([]);

    const [helper] = await db
      .insert(users)
      .values({ organizationId: owner.organizationId, email: "h@example.com", passwordHash: "x", role: "helper", pages: ["sales"] })
      .returning();
    await db.insert(sessions).values({ id: "helper-session", userId: helper.id, expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await saveHelperPages(undefined, form({ helperId: helper.id, pages: ["crm", "dashboard"] }))).toEqual({ saved: "Saved." });
    expect((await db.query.users.findFirst({ where: eq(users.id, helper.id) }))?.pages).toEqual(["dashboard", "crm"]);
    // The owner can't be edited or removed as a helper.
    expect((await saveHelperPages(undefined, form({ helperId: owner.id, pages: "crm" })))?.error).toBeTruthy();
    await removeHelper(owner.id);
    expect(await db.query.users.findFirst({ where: eq(users.id, owner.id) })).toBeTruthy();

    await removeHelper(helper.id);
    expect(await db.query.users.findFirst({ where: eq(users.id, helper.id) })).toBeUndefined();
    expect(await db.select().from(sessions)).toEqual([]);
  });

  it("never touches another account's helpers", async () => {
    const [other] = await db.insert(organizations).values({ name: "Theirs" }).returning();
    const [theirs] = await db
      .insert(users)
      .values({ organizationId: other.id, email: "t@example.com", passwordHash: "x", role: "helper", pages: ["sales"] })
      .returning();
    expect((await saveHelperPages(undefined, form({ helperId: theirs.id, pages: "crm" })))?.error).toBeTruthy();
    await removeHelper(theirs.id);
    expect(await db.query.users.findFirst({ where: eq(users.id, theirs.id) })).toBeTruthy();
  });
});

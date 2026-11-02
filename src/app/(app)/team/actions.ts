"use server";

import { and, count, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { teamInvites, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/billing/access";
import { teamLimitMessage } from "@/lib/billing/plans";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { cleanPages, INVITE_DAYS } from "@/lib/team";

export type InviteState = { error?: string; link?: string; email?: string } | undefined;
export type TeamState = { error?: string; saved?: string } | undefined;

function inviteLink(token: string): string {
  return `${process.env.APP_URL ?? ""}/join/${token}`;
}

// Helpers plus open invites, which count against the plan's team logins.
async function seatsUsed(organizationId: string): Promise<number> {
  const [helpers] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.role, "helper")));
  const [invites] = await db
    .select({ n: count() })
    .from(teamInvites)
    .where(and(eq(teamInvites.organizationId, organizationId), gt(teamInvites.expiresAt, new Date())));
  return helpers.n + invites.n;
}

const inviteEmail = z.email("Enter a valid email");

async function newInviteToken() {
  const token = randomToken();
  return { token, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) };
}

export async function inviteHelper(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const user = await requireUser("owner");
  const parsed = inviteEmail.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const pages = cleanPages(formData.getAll("pages"));
  if (pages.length === 0) return { error: "Tick at least one page your helper can use." };
  const email = parsed.data;

  const access = await getAccess(user);
  const seats = access.limits.teamSeats;
  if (seats !== null && (await seatsUsed(user.organizationId)) >= seats) return { error: teamLimitMessage(access) };

  const taken = await db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } });
  if (taken) return { error: "That email already has a Relistic login. Your helper needs to use a different email." };

  const { token, tokenHash, expiresAt } = await newInviteToken();
  // Inviting the same email again replaces the old link.
  await db.transaction(async (tx) => {
    await tx.delete(teamInvites).where(and(eq(teamInvites.organizationId, user.organizationId), eq(teamInvites.email, email)));
    await tx.insert(teamInvites).values({ organizationId: user.organizationId, email, pages, tokenHash, expiresAt });
  });
  revalidatePath("/team");
  return { link: inviteLink(token), email };
}

// Only a hash of each link is kept, so a lost link is replaced with a new one.
export async function newInviteLink(inviteId: string): Promise<InviteState> {
  const user = await requireUser("owner");
  const { token, tokenHash, expiresAt } = await newInviteToken();
  const [row] = await db
    .update(teamInvites)
    .set({ tokenHash, expiresAt })
    .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.organizationId, user.organizationId)))
    .returning({ email: teamInvites.email });
  if (!row) return { error: "That invite is gone. Refresh the page." };
  revalidatePath("/team");
  return { link: inviteLink(token), email: row.email };
}

export async function cancelInvite(inviteId: string): Promise<void> {
  const user = await requireUser("owner");
  await db.delete(teamInvites).where(and(eq(teamInvites.id, inviteId), eq(teamInvites.organizationId, user.organizationId)));
  revalidatePath("/team");
}

export async function saveHelperPages(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const user = await requireUser("owner");
  const helperId = z.uuid().safeParse(formData.get("helperId"));
  if (!helperId.success) return { error: "That helper is gone. Refresh the page." };
  const pages = cleanPages(formData.getAll("pages"));
  if (pages.length === 0) return { error: "Tick at least one page, or remove the helper instead." };
  const [row] = await db
    .update(users)
    .set({ pages })
    .where(and(eq(users.id, helperId.data), eq(users.organizationId, user.organizationId), eq(users.role, "helper")))
    .returning({ id: users.id });
  if (!row) return { error: "That helper is gone. Refresh the page." };
  revalidatePath("/team");
  return { saved: "Saved." };
}

// Removing a helper deletes their login and signs them out everywhere. Their work stays.
export async function removeHelper(helperId: string): Promise<void> {
  const user = await requireUser("owner");
  await db
    .delete(users)
    .where(and(eq(users.id, helperId), eq(users.organizationId, user.organizationId), eq(users.role, "helper")));
  revalidatePath("/team");
}

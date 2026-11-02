"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { organizations, teamInvites, users } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { homeFor } from "@/lib/team";
import { findInvite } from "@/lib/team-invites";

export type AuthState = { error?: string } | undefined;

const signupSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your business name"),
  name: z.string().trim().optional(),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(10, "Use at least 10 characters for your password"),
});

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { businessName, name, email, password } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return { error: "An account with that email already exists. Try logging in." };

  const passwordHash = await hashPassword(password);
  const userId = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: businessName }).returning();
    const [user] = await tx
      .insert(users)
      .values({ organizationId: org.id, email, name: name || null, passwordHash })
      .returning();
    return user.id;
  });
  await createSession(userId);
  redirect("/stores");
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "That email and password don't match." };
  }
  await createSession(user.id);
  redirect(homeFor(user));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

const joinSchema = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  password: z.string().min(10, "Use at least 10 characters for your password"),
});

// A helper accepts an invite: their login is made in the inviting account, with the
// pages the owner chose, and the invite is used up.
export async function acceptInvite(token: string, _prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = joinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const invite = await findInvite(token);
  if (!invite) return { error: "This invite link has expired or was cancelled. Ask for a new one." };
  const existing = await db.query.users.findFirst({ where: eq(users.email, invite.email), columns: { id: true } });
  if (existing) return { error: "That email already has a Relistic login. Log in with it, or ask for an invite to a different email." };

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.transaction(async (tx) => {
    await tx.delete(teamInvites).where(eq(teamInvites.id, invite.id));
    const [row] = await tx
      .insert(users)
      .values({
        organizationId: invite.organizationId,
        email: invite.email,
        name: parsed.data.name,
        passwordHash,
        role: "helper",
        pages: invite.pages,
      })
      .returning();
    return row;
  });
  await createSession(user.id);
  redirect(homeFor(user));
}

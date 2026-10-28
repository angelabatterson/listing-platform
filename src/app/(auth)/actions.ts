"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";

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
  redirect("/items");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { endOtherSessions, requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";

export type SettingsState = { error?: string; saved?: string } | undefined;

const profileSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your business name"),
  name: z.string().trim().optional(),
});

export async function saveProfile(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ name: parsed.data.businessName }).where(eq(organizations.id, user.organizationId));
    await tx.update(users).set({ name: parsed.data.name || null }).where(eq(users.id, user.id));
  });
  revalidatePath("/", "layout");
  return { saved: "Saved." };
}

async function checkPassword(userId: string, password: string): Promise<boolean> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { passwordHash: true } });
  return Boolean(row && (await verifyPassword(password, row.passwordHash)));
}

const emailSchema = z.object({
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(1, "Enter your current password"),
});

export async function changeEmail(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await checkPassword(user.id, parsed.data.password))) return { error: "That password isn't right." };
  const taken = await db.query.users.findFirst({
    where: and(eq(users.email, parsed.data.email), ne(users.id, user.id)),
    columns: { id: true },
  });
  if (taken) return { error: "Another account already uses that email." };
  await db.update(users).set({ email: parsed.data.email }).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { saved: "Email updated. Use it the next time you log in." };
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    password: z.string().min(10, "Use at least 10 characters for your new password"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The new passwords don't match." });

export async function changePassword(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await checkPassword(user.id, parsed.data.current))) return { error: "Your current password isn't right." };
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, user.id));
  await endOtherSessions(user.id);
  return { saved: "Password changed. Any other devices have been logged out." };
}

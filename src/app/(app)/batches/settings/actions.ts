"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { TITLE_PARTS } from "@/lib/ai/title-order";
import { requireUser } from "@/lib/auth";

const keys = TITLE_PARTS.map((p) => p.key) as [string, ...string[]];
const settingsSchema = z.object({
  titleOrder: z.array(z.enum(keys)).min(1, "Keep at least one part in your titles.").max(keys.length),
  skuFromPhoto: z.boolean(),
});

export async function saveDraftSettings(settings: { titleOrder: string[]; skuFromPhoto: boolean }): Promise<{ error?: string }> {
  const user = await requireUser("batches");
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db
    .update(organizations)
    .set({ draftSettings: { titleOrder: [...new Set(parsed.data.titleOrder)], skuFromPhoto: parsed.data.skuFromPhoto } })
    .where(eq(organizations.id, user.organizationId));
  revalidatePath("/batches/settings");
  return {};
}

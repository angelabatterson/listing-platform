"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { buyerNotes } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const noteSchema = z.object({
  marketplace: z.enum(["ebay", "etsy"]),
  buyerId: z.string().min(1),
  note: z.string().trim().max(2000, "Keep notes under 2,000 characters"),
});

export async function saveBuyerNote(formData: FormData) {
  const user = await requireUser();
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { marketplace, buyerId, note } = parsed.data;
  await db
    .insert(buyerNotes)
    .values({ organizationId: user.organizationId, marketplace, buyerId, note })
    .onConflictDoUpdate({
      target: [buyerNotes.organizationId, buyerNotes.marketplace, buyerNotes.buyerId],
      set: { note, updatedAt: new Date() },
    });
  revalidatePath("/buyers");
}

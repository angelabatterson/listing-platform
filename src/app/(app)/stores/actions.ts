"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { ensureEbayLocation } from "@/lib/marketplaces/ebay/adapter";

export type StoreSettingsState = { error?: string; saved?: boolean } | undefined;

const ebaySettingsSchema = z.object({
  fulfillmentPolicyId: z.string().min(1, "Choose a shipping policy"),
  paymentPolicyId: z.string().min(1, "Choose a payment policy"),
  returnPolicyId: z.string().min(1, "Choose a return policy"),
  postalCode: z.string().trim().min(3, "Enter the ZIP or postal code you ship from"),
  country: z.string().length(2),
});

export async function saveEbaySettings(
  connectionId: string,
  _prev: StoreSettingsState,
  formData: FormData,
): Promise<StoreSettingsState> {
  const user = await requireUser();
  const parsed = ebaySettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const connection = await db.query.connections.findFirst({
    where: and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)),
  });
  if (!connection) return { error: "Store not found" };

  const { postalCode, country, ...policies } = parsed.data;
  try {
    const merchantLocationKey = await ensureEbayLocation(connection, { postalCode, country });
    await db
      .update(connections)
      .set({ settings: { ...connection.settings, ...policies, merchantLocationKey, postalCode, country } })
      .where(eq(connections.id, connection.id));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "eBay rejected the location" };
  }
  revalidatePath("/stores");
  return { saved: true };
}

export async function disconnectStore(connectionId: string) {
  const user = await requireUser();
  await db
    .update(connections)
    .set({ status: "disconnected" })
    .where(and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)));
  revalidatePath("/stores");
}

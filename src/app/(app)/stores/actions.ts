"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccess, usage } from "@/lib/billing/access";
import { inactiveMessage } from "@/lib/billing/plans";
import { importPage, isImportable, type ImportCounts } from "@/lib/import";
import { createStarterPolicies, ensureEbayLocation, optInToBusinessPolicies } from "@/lib/marketplaces/ebay/adapter";
import { isExtensionMarketplace, type ExtensionMarketplace } from "@/lib/marketplaces/labels";

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

const starterPoliciesSchema = z.object({
  shipping: z.coerce.number().min(0, "Enter a shipping charge, or 0 for free shipping").max(500),
  handlingDays: z.coerce.number().int().min(0).max(30),
  returnDays: z.enum(["0", "30", "60"]),
});

// Make the shipping, payment and return policies eBay requires, and pick them.
export async function createEbayStarterPolicies(
  connectionId: string,
  _prev: StoreSettingsState,
  formData: FormData,
): Promise<StoreSettingsState> {
  const user = await requireUser();
  const parsed = starterPoliciesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const connection = await db.query.connections.findFirst({
    where: and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)),
  });
  if (!connection || connection.marketplace !== "ebay") return { error: "Store not found" };

  try {
    await optInToBusinessPolicies(connection);
    const ids = await createStarterPolicies(connection, {
      shippingCents: Math.round(parsed.data.shipping * 100),
      handlingDays: parsed.data.handlingDays,
      returnDays: Number(parsed.data.returnDays) as 0 | 30 | 60,
    });
    await db
      .update(connections)
      .set({ settings: { ...connection.settings, ...ids } })
      .where(eq(connections.id, connection.id));
  } catch (err) {
    return { error: err instanceof Error ? `eBay said: ${err.message}` : "eBay didn't accept the policies. Try again." };
  }
  revalidatePath("/stores");
  return { saved: true };
}

// Poshmark, Depop and Facebook have no sign-in to Relistic: the extension works in the
// seller's own browser, so adding the store just makes it available to tick on items.
export async function addExtensionStore(marketplace: ExtensionMarketplace) {
  const user = await requireUser();
  if (!isExtensionMarketplace(marketplace)) return;
  await db
    .insert(connections)
    .values({ organizationId: user.organizationId, marketplace, environment: "production", status: "active" })
    .onConflictDoUpdate({
      target: [connections.organizationId, connections.marketplace],
      set: { status: "active" },
    });
  revalidatePath("/stores");
}

export async function disconnectStore(connectionId: string) {
  const user = await requireUser();
  await db
    .update(connections)
    .set({ status: "disconnected" })
    .where(and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)));
  revalidatePath("/stores");
}

const etsySettingsSchema = z.object({
  shippingProfileId: z.string().regex(/^\d+$/, "Choose a shipping profile"),
  returnPolicyId: z.string().regex(/^\d+$/, "Choose a return policy"),
  readinessStateId: z.string().regex(/^\d+$/, "Choose a processing profile"),
  whoMade: z.enum(["someone_else", "i_did", "collective"]),
});

export async function saveEtsySettings(
  connectionId: string,
  _prev: StoreSettingsState,
  formData: FormData,
): Promise<StoreSettingsState> {
  const user = await requireUser();
  const parsed = etsySettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const connection = await db.query.connections.findFirst({
    where: and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)),
  });
  if (!connection) return { error: "Store not found" };

  await db
    .update(connections)
    .set({ settings: { ...connection.settings, ...parsed.data } })
    .where(eq(connections.id, connection.id));
  revalidatePath("/stores");
  return { saved: true };
}

export type ImportStep = { error?: string; counts?: ImportCounts; total?: number; done?: boolean };

// Import one page of a store's live listings. The Stores page calls this page by page
// so a big shop shows progress and no single request runs too long.
export async function importStorePage(connectionId: string, page: number): Promise<ImportStep> {
  const user = await requireUser();
  const connection = await db.query.connections.findFirst({
    where: and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)),
  });
  if (!connection || !isImportable(connection.marketplace)) return { error: "Store not found" };
  if (connection.status !== "active") return { error: "Reconnect this store first." };
  const access = await getAccess(user);
  if (!access.canWrite) return { error: inactiveMessage(access) };
  const cap = access.limits.activeListings;
  const room = cap === null ? null : Math.max(0, cap - (await usage(user.organizationId)).activeListings);
  try {
    const result = await importPage(connection, Math.max(1, Math.floor(page)), room);
    if (result.done) revalidatePath("/items");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The store didn't answer. Try again." };
  }
}

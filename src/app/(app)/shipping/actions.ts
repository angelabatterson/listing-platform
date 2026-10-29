"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { connections, sales, shippingLabels, shippingSettings, type ParcelSize } from "@/db/schema";
import type { SettingsState } from "@/app/(app)/account/actions";
import { requireUser } from "@/lib/auth";
import { writeProblem } from "@/lib/billing/access";
import { encrypt } from "@/lib/crypto";
import { fetchOrderToShip, sendTracking } from "@/lib/shipping/orders";
import { readyShipping } from "@/lib/shipping/settings";
import { buyLabel, checkToken, getRates, isTestToken, looksLikeShippoToken, ShippoError, type Rate } from "@/lib/shipping/shippo";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function upsertSettings(orgId: string, values: Partial<typeof shippingSettings.$inferInsert>) {
  await db
    .insert(shippingSettings)
    .values({ organizationId: orgId, ...values })
    .onConflictDoUpdate({ target: shippingSettings.organizationId, set: values });
  revalidatePath("/shipping");
}

export async function saveShippoKey(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const token = String(formData.get("token") ?? "").trim();
  if (!looksLikeShippoToken(token)) {
    return { error: "That doesn't look like a Shippo key. It starts with shippo_live_ (or shippo_test_ for testing)." };
  }
  try {
    await checkToken(token);
  } catch (err) {
    return { error: err instanceof ShippoError ? err.message : "Couldn't reach Shippo to check the key. Try again in a minute." };
  }
  await upsertSettings(user.organizationId, { apiTokenEnc: encrypt(token), testMode: isTestToken(token) });
  return {
    saved: isTestToken(token)
      ? "Test key saved. Labels you buy are samples and can't be used to ship."
      : "Shippo key saved. Labels are charged to your Shippo account.",
  };
}

const addressSchema = z.object({
  name: z.string().trim().min(1, "Enter the name to ship from"),
  company: z.string().trim().optional(),
  street1: z.string().trim().min(1, "Enter the street address"),
  street2: z.string().trim().optional(),
  city: z.string().trim().min(1, "Enter the city"),
  state: z.string().trim().min(2, "Enter the state, like NY").max(30),
  zip: z.string().trim().min(3, "Enter the ZIP code").max(12),
  phone: z.string().trim().min(7, "Enter a phone number. Carriers need one for some services."),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional(),
});

export async function saveFromAddress(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const a = parsed.data;
  await upsertSettings(user.organizationId, {
    fromAddress: { ...a, state: a.state.toUpperCase(), country: "US", company: a.company || undefined, street2: a.street2 || undefined, email: a.email || undefined },
  });
  return { saved: "Ship-from address saved." };
}

const parcelSchema = z.object({
  lengthIn: z.coerce.number().positive("Enter the box length in inches").max(108),
  widthIn: z.coerce.number().positive("Enter the box width in inches").max(108),
  heightIn: z.coerce.number().positive("Enter the box height in inches").max(108),
  pounds: z.coerce.number().min(0).max(150).default(0),
  ounces: z.coerce.number().min(0).max(2400).default(0),
});

function parseParcel(formData: FormData): { parcel?: ParcelSize; error?: string } {
  const parsed = parcelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { lengthIn, widthIn, heightIn, pounds, ounces } = parsed.data;
  const weightOz = Math.round((pounds * 16 + ounces) * 10) / 10;
  if (weightOz <= 0) return { error: "Enter how much the packed parcel weighs." };
  return { parcel: { lengthIn, widthIn, heightIn, weightOz } };
}

export async function saveDefaultParcel(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const { parcel, error } = parseParcel(formData);
  if (!parcel) return { error };
  await upsertSettings(user.organizationId, { defaultParcel: parcel });
  return { saved: "Usual box saved." };
}

// The store an order was sold on, if the order is one of this account's sales.
async function orderStore(orgId: string, connectionId: string, orderId: string) {
  const sold = await db.query.sales.findFirst({
    where: and(eq(sales.organizationId, orgId), eq(sales.connectionId, connectionId), eq(sales.externalOrderId, orderId)),
    columns: { id: true },
  });
  const connection = sold
    ? await db.query.connections.findFirst({
        where: and(eq(connections.id, connectionId), eq(connections.organizationId, orgId)),
      })
    : undefined;
  if (!connection) throw new Error("That order wasn't found.");
  return connection;
}

export type RatesState = { rates?: Rate[]; error?: string } | undefined;

export async function quoteRates(
  connectionId: string,
  orderId: string,
  _prev: RatesState,
  formData: FormData,
): Promise<RatesState> {
  const user = await requireUser();
  const { parcel, error } = parseParcel(formData);
  if (!parcel) return { error };
  const { ready, missing } = await readyShipping(user.organizationId);
  if (!ready) return { error: missing };
  try {
    const connection = await orderStore(user.organizationId, connectionId, orderId);
    const order = await fetchOrderToShip(connection, orderId);
    if (!order.shipTo) return { error: "The store didn't share a shipping address for this order." };
    return { rates: await getRates(ready.token, ready.fromAddress, order.shipTo, parcel) };
  } catch (err) {
    return { error: errorText(err) };
  }
}

async function pushTracking(labelId: string, orgId: string) {
  const label = await db.query.shippingLabels.findFirst({
    where: and(eq(shippingLabels.id, labelId), eq(shippingLabels.organizationId, orgId)),
  });
  if (!label?.trackingNumber || label.trackingSentAt) return;
  // Sample labels carry made-up tracking numbers that a store would reject or show the buyer.
  if (label.testMode) {
    await db.update(shippingLabels).set({ trackingError: "Test label, so the tracking wasn't sent to the store." }).where(eq(shippingLabels.id, labelId));
    return;
  }
  try {
    const connection = await orderStore(orgId, label.connectionId, label.externalOrderId);
    const order = await fetchOrderToShip(connection, label.externalOrderId);
    await sendTracking(connection, label.externalOrderId, order, label.carrier, label.trackingNumber);
    await db.update(shippingLabels).set({ trackingSentAt: new Date(), trackingError: null }).where(eq(shippingLabels.id, labelId));
  } catch (err) {
    await db.update(shippingLabels).set({ trackingError: errorText(err) }).where(eq(shippingLabels.id, labelId));
  }
}

export type BuyState = { error?: string } | undefined;

export async function buyShippingLabel(
  connectionId: string,
  orderId: string,
  rateId: string,
): Promise<BuyState> {
  const user = await requireUser();
  const blocked = await writeProblem(user);
  if (blocked) return { error: blocked };
  const { ready, missing } = await readyShipping(user.organizationId);
  if (!ready) return { error: missing };
  let labelId: string;
  try {
    const connection = await orderStore(user.organizationId, connectionId, orderId);
    const label = await buyLabel(ready.token, rateId);
    const [row] = await db
      .insert(shippingLabels)
      .values({
        organizationId: user.organizationId,
        connectionId: connection.id,
        externalOrderId: orderId,
        provider: "shippo",
        providerLabelId: label.id,
        carrier: label.rate.carrier,
        service: label.rate.service,
        costCents: label.rate.costCents,
        currency: label.rate.currency,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        labelUrl: label.labelUrl,
        testMode: ready.testMode,
      })
      .returning({ id: shippingLabels.id });
    labelId = row.id;
  } catch (err) {
    return { error: errorText(err) };
  }
  await pushTracking(labelId, user.organizationId);
  revalidatePath("/shipping");
  redirect(`/shipping/${connectionId}/${encodeURIComponent(orderId)}?bought=1`);
}

export async function retryTracking(labelId: string) {
  const user = await requireUser();
  await pushTracking(labelId, user.organizationId);
  revalidatePath("/shipping", "layout");
}

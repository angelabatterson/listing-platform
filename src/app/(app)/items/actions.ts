"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { channelListings, connections, itemImages, items } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { syncItem } from "@/lib/sync/run";

export type ItemFormState = { error?: string } | undefined;

const dollarsToCents = (v: string) => Math.round(Number(v) * 100);

const itemSchema = z.object({
  title: z.string().trim().min(1, "Give the item a title"),
  sku: z
    .string()
    .trim()
    .min(1, "Give the item a SKU (your own stock code)")
    .max(50, "SKUs can be at most 50 characters")
    .regex(/^[A-Za-z0-9_-]+$/, "SKUs can only use letters, numbers, dashes and underscores"),
  description: z.string().trim().default(""),
  price: z.string().refine((v) => Number(v) > 0, "Enter a price above zero"),
  quantity: z.coerce.number().int().min(0, "Quantity can't be negative"),
  condition: z.string().min(1),
  brand: z.string().trim().optional(),
  status: z.enum(["draft", "active"]),
  imageUrls: z.string().default(""),
});

export async function saveItem(
  itemId: string | null,
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const user = await requireUser();
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const values = {
    organizationId: user.organizationId,
    title: data.title,
    sku: data.sku,
    description: data.description,
    priceCents: dollarsToCents(data.price),
    quantity: data.quantity,
    condition: data.condition,
    brand: data.brand || null,
    status: data.status,
  };
  const imageUrls = data.imageUrls
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);

  const orgConnections = await db.query.connections.findMany({
    where: eq(connections.organizationId, user.organizationId),
  });

  const skuOwner = await db.query.items.findFirst({
    where: and(eq(items.organizationId, user.organizationId), eq(items.sku, data.sku)),
    columns: { id: true },
  });
  if (skuOwner && skuOwner.id !== itemId) return { error: "Another item already uses that SKU." };

  // Marketplaces key listings by SKU, so it's locked once an item has been listed.
  if (itemId) {
    const existing = await db.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.organizationId, user.organizationId)),
      with: { listings: { columns: { remoteOfferId: true, remoteListingId: true } } },
    });
    const everListed = existing?.listings.some((l) => l.remoteOfferId || l.remoteListingId);
    if (existing && everListed && existing.sku !== data.sku) {
      return { error: "The SKU can't be changed after the item has been listed." };
    }
  }

  const id = await db.transaction(async (tx) => {
    let savedId = itemId;
    if (savedId) {
      const updated = await tx
        .update(items)
        .set(values)
        .where(and(eq(items.id, savedId), eq(items.organizationId, user.organizationId)))
        .returning({ id: items.id });
      if (updated.length === 0) throw new Error("Item not found");
    } else {
      const [created] = await tx.insert(items).values(values).returning({ id: items.id });
      savedId = created.id;
    }

    await tx.delete(itemImages).where(eq(itemImages.itemId, savedId));
    if (imageUrls.length) {
      await tx.insert(itemImages).values(imageUrls.map((url, position) => ({ itemId: savedId!, url, position })));
    }

    for (const c of orgConnections) {
      const price = String(formData.get(`price_${c.id}`) ?? "").trim();
      const overrides = {
        categoryId: String(formData.get(`category_${c.id}`) ?? "").trim() || undefined,
        priceCents: price ? dollarsToCents(price) : undefined,
      };
      const enabled = formData.get(`list_${c.id}`) === "on";
      await tx
        .insert(channelListings)
        .values({ itemId: savedId, connectionId: c.id, enabled, overrides })
        .onConflictDoUpdate({
          target: [channelListings.itemId, channelListings.connectionId],
          set: { enabled, overrides },
        });
    }
    return savedId;
  });

  await syncItem(user.organizationId, id);
  revalidatePath("/items");
  redirect(`/items/${id}?saved=1`);
}

export async function archiveItem(itemId: string) {
  const user = await requireUser();
  await db
    .update(items)
    .set({ status: "archived" })
    .where(and(eq(items.id, itemId), eq(items.organizationId, user.organizationId)));
  await syncItem(user.organizationId, itemId);
  revalidatePath("/items");
  redirect("/items");
}

export async function resyncItem(itemId: string) {
  const user = await requireUser();
  await syncItem(user.organizationId, itemId);
  revalidatePath(`/items/${itemId}`);
}

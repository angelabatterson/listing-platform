"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { connections, items, sales } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isMoneyField, MONEY_FIELDS, parseDollars } from "@/lib/sale-fields";
import { importSalesCsv, parseSaleDate } from "@/lib/sales-import";
import { recordSales } from "@/lib/sync/sales";

export type SalesResult = { error?: string; message?: string; problems?: string[] };

const id = z.uuid();

function refresh() {
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

// One money box in a sale's row. Blank puts it back to what Relistic works out.
export async function saveSaleMoney(saleId: string, field: string, value: string): Promise<SalesResult> {
  const user = await requireUser();
  if (!id.safeParse(saleId).success || !isMoneyField(field)) return { error: "Sale not found." };
  const cents = parseDollars(value);
  if (cents === undefined) return { error: "Enter an amount, like 4.50." };
  const column = MONEY_FIELDS[field].column;
  const [updated] = await db
    .update(sales)
    .set({ [column]: cents, ...(field === "fees" ? { feesEstimated: false } : {}) })
    .where(and(eq(sales.id, saleId), eq(sales.organizationId, user.organizationId)))
    .returning({ id: sales.id });
  if (!updated) return { error: "Sale not found." };
  refresh();
  return {};
}

const MAX_FILE_BYTES = 2_000_000;

export async function importSales(_prev: SalesResult | undefined, formData: FormData): Promise<SalesResult> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a CSV file first." };
  if (file.size > MAX_FILE_BYTES) return { error: "That file is too big. Split it into smaller files." };
  const result = await importSalesCsv(user.organizationId, await file.text());
  refresh();
  const parts = [
    result.updated && `Updated ${result.updated} ${result.updated === 1 ? "sale" : "sales"}.`,
    result.added && `Added ${result.added} ${result.added === 1 ? "sale" : "sales"}.`,
    result.unchanged && `${result.unchanged} ${result.unchanged === 1 ? "row was" : "rows were"} already up to date.`,
  ].filter(Boolean);
  return {
    message: parts.length ? parts.join(" ") : result.problems.length ? undefined : "Nothing to change in that file.",
    problems: result.problems,
  };
}

const addSchema = z.object({
  connectionId: z.uuid({ error: "Pick the store it sold on." }),
  date: z.string(),
  title: z.string().trim().max(300),
  sku: z.string().trim().max(100),
  quantity: z.coerce.number().int("Quantity should be a whole number.").min(1, "Quantity should be at least 1.").max(10_000),
  price: z.string(),
  shipping: z.string(),
  fees: z.string(),
  lowerStock: z.boolean(),
});

// A sale typed in by hand, e.g. one from a store Relistic doesn't hear about.
export async function addSale(_prev: SalesResult | undefined, formData: FormData): Promise<SalesResult> {
  const user = await requireUser();
  const s = (k: string) => String(formData.get(k) ?? "");
  const parsed = addSchema.safeParse({
    connectionId: s("connectionId"),
    date: s("date"),
    title: s("title"),
    sku: s("sku"),
    quantity: s("quantity") || "1",
    price: s("price"),
    shipping: s("shipping"),
    fees: s("fees"),
    lowerStock: formData.get("lowerStock") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const f = parsed.data;
  const soldAt = parseSaleDate(f.date);
  if (!soldAt) return { error: "Enter the date it sold." };
  if (!f.title && !f.sku) return { error: "Enter the item's title or SKU." };
  const money = { price: parseDollars(f.price), shipping: parseDollars(f.shipping), fees: parseDollars(f.fees) };
  if (Object.values(money).includes(undefined)) return { error: "Enter amounts like 24.99." };

  const store = await db.query.connections.findFirst({
    where: and(eq(connections.id, f.connectionId), eq(connections.organizationId, user.organizationId)),
  });
  if (!store) return { error: "Pick the store it sold on." };
  const item = f.sku
    ? await db.query.items.findFirst({
        where: and(eq(items.organizationId, user.organizationId), eq(items.sku, f.sku)),
        columns: { id: true, title: true },
      })
    : undefined;
  if (f.lowerStock && !item) return { error: "No item has that SKU, so there's no stock to lower. Untick the box or fix the SKU." };

  const lineId = `manual-${randomUUID()}`;
  const line = {
    orderId: lineId,
    lineId,
    sku: f.sku || null,
    remoteListingId: null,
    quantity: f.quantity,
    soldAt,
    title: f.title || item?.title || null,
    currency: "USD",
    priceCents: money.price ?? null,
    shippingCents: money.shipping ?? null,
    feesCents: money.fees ?? null,
  };
  if (f.lowerStock) {
    // The same as a sale found on a store: stock goes down and other stores update.
    await recordSales(store, [line], { manual: true });
  } else {
    await db.insert(sales).values({
      organizationId: user.organizationId,
      connectionId: store.id,
      itemId: item?.id ?? null,
      externalOrderId: lineId,
      externalLineId: lineId,
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      soldAt,
      currency: "USD",
      priceCents: line.priceCents,
      shippingCents: line.shippingCents,
      feesCents: line.feesCents,
      manual: true,
    });
  }
  refresh();
  revalidatePath("/items");
  return { message: f.lowerStock ? "Sale added, and the stock was lowered." : "Sale added." };
}

// Only sales typed in or uploaded by hand can be deleted. Stock isn't put back.
export async function deleteManualSale(saleId: string): Promise<SalesResult> {
  const user = await requireUser();
  if (!id.safeParse(saleId).success) return { error: "Sale not found." };
  const [gone] = await db
    .delete(sales)
    .where(and(eq(sales.id, saleId), eq(sales.organizationId, user.organizationId), eq(sales.manual, true)))
    .returning({ id: sales.id });
  if (!gone) return { error: "Only sales you added yourself can be deleted." };
  refresh();
  return {};
}

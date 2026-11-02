import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { connections, items, sales, type Connection } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { MONEY_FIELD_KEYS, MONEY_FIELDS, parseDollars, type MoneyField } from "@/lib/sale-fields";
import { moneyValue, salesById } from "@/lib/sales-table";
import { storeLabel } from "@/lib/stores";

export const IMPORT_MAX_ROWS = 2000;

export type ImportResult = { updated: number; added: number; unchanged: number; problems: string[] };

// "2026-10-31", "10/31/2026" or "Oct 31, 2026" as noon UTC that day.
export function parseSaleDate(text: string): Date | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return day(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) return day(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  const parsed = new Date(t);
  return t && !Number.isNaN(parsed.getTime()) ? day(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()) : null;
}

function day(y: number, mo: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y > 1990 && y < 2100 ? date : null;
}

// Which of the organization's stores a "Store" cell names: "eBay", or "eBay (myshop)" when there are two.
export function matchStore(stores: Connection[], name: string): Connection | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const exact = stores.find((c) => storeLabel(c).toLowerCase() === n);
  if (exact) return exact;
  const byKind = stores.filter((c) => MARKETPLACE_LABELS[c.marketplace].toLowerCase() === n || c.marketplace === n);
  return byKind.find((c) => c.status !== "disconnected") ?? byKind[0] ?? null;
}

// Save a sales spreadsheet: rows with a Sale ID update that sale's money (only the amounts
// that changed); rows without one are added as sales typed in by hand. Adding a sale this
// way doesn't change stock. Uploading the same file twice doesn't add its sales twice.
export async function importSalesCsv(orgId: string, text: string): Promise<ImportResult> {
  const [header, ...rows] = parseCsv(text);
  const result: ImportResult = { updated: 0, added: 0, unchanged: 0, problems: [] };
  if (!header) return { ...result, problems: ["The file is empty."] };
  if (rows.length > IMPORT_MAX_ROWS) return { ...result, problems: [`Upload at most ${IMPORT_MAX_ROWS} rows at a time.`] };

  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const cell = (row: string[], name: string) => {
    const i = col.get(name.toLowerCase());
    return i === undefined ? undefined : (row[i] ?? "").trim();
  };
  if (!col.has("sale id") && !(col.has("store") && (col.has("title") || col.has("sku")))) {
    return { ...result, problems: ['Couldn\'t find a "Sale ID" column, or "Store" and "Title" columns. Start from a downloaded sales file.'] };
  }

  const problem = (rowNumber: number, text: string) => {
    if (result.problems.length < 20) result.problems.push(`Row ${rowNumber}: ${text}`);
  };
  // Amounts in a row, by field; a blank cell means "leave as it is".
  const amounts = (row: string[], rowNumber: number) => {
    const out: Partial<Record<MoneyField, number>> = {};
    for (const k of MONEY_FIELD_KEYS) {
      const raw = cell(row, MONEY_FIELDS[k].heading);
      if (raw === undefined || raw === "") continue;
      const cents = parseDollars(raw);
      if (cents === undefined) {
        problem(rowNumber, `"${raw}" under ${MONEY_FIELDS[k].heading} isn't an amount.`);
        return null;
      }
      if (cents !== null) out[k] = cents;
    }
    return out;
  };

  const ids = rows.map((r) => cell(r, "Sale ID") ?? "").filter(Boolean);
  const existing = new Map((await salesById(orgId, ids)).map((r) => [r.sale.id, r]));
  const stores = await db.query.connections.findMany({ where: eq(connections.organizationId, orgId) });
  const skus = [...new Set(rows.map((r) => cell(r, "SKU") ?? "").filter(Boolean))];
  const itemBySku = new Map(
    skus.length
      ? (
          await db
            .select({ id: items.id, sku: items.sku })
            .from(items)
            .where(and(eq(items.organizationId, orgId), inArray(items.sku, skus)))
        ).map((i) => [i.sku, i.id])
      : [],
  );
  const seen = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const saleId = cell(row, "Sale ID");
    const money = amounts(row, rowNumber);
    if (!money) continue;

    if (saleId) {
      const found = existing.get(saleId);
      if (!found) {
        problem(rowNumber, "No sale with that Sale ID in your account.");
        continue;
      }
      const changes: Record<string, number | boolean> = {};
      for (const [k, cents] of Object.entries(money) as [MoneyField, number][]) {
        if (moneyValue(found.sale, found.money, k) !== cents) changes[MONEY_FIELDS[k].column] = cents;
      }
      if (!Object.keys(changes).length) {
        result.unchanged++;
        continue;
      }
      if ("feesCents" in changes) changes.feesEstimated = false;
      await db.update(sales).set(changes).where(and(eq(sales.id, saleId), eq(sales.organizationId, orgId)));
      result.updated++;
      continue;
    }

    const store = matchStore(stores, cell(row, "Store") ?? "");
    const title = cell(row, "Title") ?? "";
    const sku = cell(row, "SKU") ?? "";
    const soldAt = parseSaleDate(cell(row, "Date") ?? "");
    const qtyText = cell(row, "Qty") || "1";
    const quantity = /^\d+$/.test(qtyText) ? Number(qtyText) : NaN;
    if (!store) {
      problem(rowNumber, `"${cell(row, "Store") ?? ""}" isn't one of your stores. Connect it first, or use a store name like eBay.`);
      continue;
    }
    if (!title && !sku) {
      problem(rowNumber, "Add a Title or SKU.");
      continue;
    }
    if (!soldAt) {
      problem(rowNumber, "Add the date it sold, like 2026-10-31.");
      continue;
    }
    if (!(quantity >= 1 && quantity <= 10_000)) {
      problem(rowNumber, "Qty should be a whole number, like 1.");
      continue;
    }
    // The same row uploaded again gets the same id, so it isn't added twice.
    const fingerprint = [store.id, soldAt.toISOString(), title, sku, quantity, JSON.stringify(money)].join("|");
    const nth = (seen.get(fingerprint) ?? 0) + 1;
    seen.set(fingerprint, nth);
    const lineId = `manual-${createHash("sha256").update(`${fingerprint}|${nth}`).digest("hex").slice(0, 32)}`;
    const [added] = await db
      .insert(sales)
      .values({
        organizationId: orgId,
        connectionId: store.id,
        itemId: (sku && itemBySku.get(sku)) || null,
        externalOrderId: lineId,
        externalLineId: lineId,
        sku: sku || null,
        title: title || null,
        quantity,
        soldAt,
        currency: "USD",
        buyerName: cell(row, "Buyer") || null,
        manual: true,
        ...Object.fromEntries((Object.entries(money) as [MoneyField, number][]).map(([k, v]) => [MONEY_FIELDS[k].column, v])),
      })
      .onConflictDoNothing()
      .returning({ id: sales.id });
    if (added) result.added++;
    else result.unchanged++;
  }
  return result;
}

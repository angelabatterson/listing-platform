import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { connections, items, organizations, sales, shippingLabels } from "@/db/schema";

const user = { id: "", organizationId: "", email: "a@b.c", name: null };
vi.mock("@/lib/auth", () => ({ requireUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const syncItem = vi.fn(async () => []);
vi.mock("@/lib/sync/run", () => ({ syncItem: (...args: unknown[]) => syncItem(...(args as [])) }));

const { addSale, deleteManualSale, saveSaleMoney } = await import("@/app/(app)/sales/actions");
const { listSales, parseSalesFilters, allSales, salesCsvRows } = await import("@/lib/sales-table");
const { importSalesCsv } = await import("@/lib/sales-import");
const { salesTotals } = await import("@/lib/dashboard");
const { toCsv } = await import("@/lib/csv");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("the Sales page", () => {
  let org: string;
  let ebay: string;
  let posh: string;
  let jacket: string;

  beforeEach(async () => {
    await db.delete(organizations);
    syncItem.mockClear();
    [{ id: org }] = await db.insert(organizations).values({ name: "Mine" }).returning();
    user.organizationId = org;
    [{ id: ebay }, { id: posh }] = await db
      .insert(connections)
      .values([
        { organizationId: org, marketplace: "ebay", environment: "production" },
        { organizationId: org, marketplace: "poshmark", environment: "production" },
      ])
      .returning();
    [{ id: jacket }] = await db
      .insert(items)
      .values({ organizationId: org, sku: "J-1", title: "Denim jacket", priceCents: 4500, costCents: 1000, quantity: 3, status: "active" })
      .returning();
    const soldAt = new Date("2026-10-30T15:00:00Z");
    await db.insert(sales).values([
      { organizationId: org, connectionId: ebay, itemId: jacket, externalOrderId: "O1", externalLineId: "L1", quantity: 1, soldAt, priceCents: 4500, shippingCents: 500, feesCents: 600, sku: "J-1" },
      { organizationId: org, connectionId: ebay, itemId: null, externalOrderId: "O1", externalLineId: "L2", quantity: 1, soldAt, priceCents: 2000, title: "Belt" },
    ]);
    await db.insert(shippingLabels).values({
      organizationId: org,
      connectionId: ebay,
      externalOrderId: "O1",
      provider: "shippo",
      providerLabelId: "x",
      carrier: "USPS",
      service: "Ground",
      costCents: 700,
      labelUrl: "https://label.example/1.pdf",
    });
  });

  afterAll(async () => {
    await db.delete(organizations);
  });

  const page = async () => (await listSales(org, parseSalesFilters({}))).rows;

  it("works out each sale's money, counting an order's label once", async () => {
    const rows = await page();
    const jacketRow = rows.find((r) => r.sale.externalLineId === "L1")!;
    const belt = rows.find((r) => r.sale.externalLineId === "L2")!;
    expect(jacketRow.money).toMatchObject({ cost: 1000, shippingCost: 700, profit: 4500 + 500 - 600 - 700 - 1000 });
    expect(belt.money).toMatchObject({ shippingCost: 0, costKnown: false, profit: 2000 });
    expect(jacketRow.label?.labelUrl).toBe("https://label.example/1.pdf");
    expect(jacketRow.orderLink).toBe("https://www.ebay.com/sh/ord/details?orderid=O1");
    expect((await listSales(org, parseSalesFilters({ q: "belt" }))).total).toBe(1);
  });

  it("narrows to a time period", async () => {
    const custom = (from: string, to: string) => listSales(org, parseSalesFilters({ period: "custom", from, to }));
    expect((await custom("2026-10-30", "2026-10-30")).total).toBe(2);
    expect((await custom("2026-10-31", "")).total).toBe(0);
    expect((await custom("", "2026-10-29")).total).toBe(0);
    expect(parseSalesFilters({ period: "nonsense" }).period).toBe("all");
  });

  it("saves typed amounts, and only for the seller's own sales", async () => {
    const [row] = (await page()).filter((r) => r.sale.externalLineId === "L1");
    expect(await saveSaleMoney(row.sale.id, "cost", "8")).toEqual({});
    expect(await saveSaleMoney(row.sale.id, "fees", "$5.25")).toEqual({});
    expect(await saveSaleMoney(row.sale.id, "fees", "lots")).toHaveProperty("error");
    expect(await saveSaleMoney(row.sale.id, "nonsense", "1")).toHaveProperty("error");
    const after = (await page()).find((r) => r.sale.id === row.sale.id)!;
    expect(after.money).toMatchObject({ cost: 800, fees: 525 });
    // The dashboard uses the sale's own cost too.
    expect((await salesTotals(org, null, null)).cost).toBe(800);

    const [other] = await db.insert(organizations).values({ name: "Other" }).returning();
    user.organizationId = other.id;
    expect(await saveSaleMoney(row.sale.id, "cost", "1")).toEqual({ error: "Sale not found." });
  });

  it("round-trips the spreadsheet: changed amounts update, new rows are added once", async () => {
    const csv = toCsv(salesCsvRows(await allSales(org, parseSalesFilters({}))));
    // Unchanged file: nothing changes, and computed amounts aren't frozen.
    expect(await importSalesCsv(org, csv)).toMatchObject({ updated: 0, added: 0, unchanged: 2 });
    expect((await db.select().from(sales).where(eq(sales.externalLineId, "L1")))[0].costCents).toBeNull();

    const [header, ...rows] = csv.trim().split("\r\n");
    const cols = header.split(",");
    const l1 = rows.find((r) => r.includes("Denim jacket"))!.split(",");
    l1[cols.indexOf("Other costs")] = "2.50";
    const newRow = cols.map((c) =>
      ({ Store: "Poshmark", Date: "10/31/2026", Title: "Silk scarf", SKU: "J-1", Qty: "1", Price: "30", "Store fees": "6" })[c] ?? "",
    );
    const edited = [header, l1.join(","), newRow.join(","), ["", "", "Nowhere", "", "Thing"].join(",")].join("\n");
    const result = await importSalesCsv(org, edited);
    expect(result).toMatchObject({ updated: 1, added: 1 });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("Row 4");
    expect((await importSalesCsv(org, edited)).added).toBe(0);

    const scarf = (await db.select().from(sales).where(eq(sales.connectionId, posh)))[0];
    expect(scarf).toMatchObject({ manual: true, itemId: jacket, priceCents: 3000, feesCents: 600, quantity: 1 });
    expect((await db.select().from(items).where(eq(items.id, jacket)))[0].quantity).toBe(3);
    expect((await db.select().from(sales).where(eq(sales.externalLineId, "L1")))[0].otherCostCents).toBe(250);
  });

  it("adds a sale by hand, lowering stock only when asked, and deletes it", async () => {
    const base = { connectionId: posh, date: "2026-11-01", sku: "J-1", title: "", quantity: "1", price: "40", shipping: "", fees: "8" };
    expect(await addSale(undefined, form(base))).toEqual({ message: "Sale added." });
    expect((await db.select().from(items).where(eq(items.id, jacket)))[0].quantity).toBe(3);
    expect(await addSale(undefined, form({ ...base, lowerStock: "on" }))).toEqual({ message: "Sale added, and the stock was lowered." });
    expect((await db.select().from(items).where(eq(items.id, jacket)))[0].quantity).toBe(2);
    expect(syncItem).toHaveBeenCalledWith(org, jacket, { soldOn: posh });
    expect(await addSale(undefined, form({ ...base, sku: "NOPE", lowerStock: "on" }))).toHaveProperty("error");

    const manual = await db.select().from(sales).where(eq(sales.manual, true));
    expect(manual).toHaveLength(2);
    expect(manual[0].title).toBe("Denim jacket");
    expect(await deleteManualSale(manual[0].id)).toEqual({});
    const [storeSale] = await db.select().from(sales).where(eq(sales.externalLineId, "L1"));
    expect(await deleteManualSale(storeSale.id)).toHaveProperty("error");
  });
});

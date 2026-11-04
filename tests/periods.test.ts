import { describe, expect, it } from "vitest";
import { chosenPrice, previewPrice, withChoices } from "@/lib/crosslist";
import { cutTitle } from "@/lib/marketplaces/cut-title";
import { periodRange, rangeSlug } from "@/lib/periods";
import { fewStores, money, pnlPdf, summarizeYear } from "@/lib/pnl";
import type { SaleMoney } from "@/lib/sales-table";

const now = new Date("2026-03-15T12:00:00Z");
const iso = (r: { start?: Date; end?: Date }) => [r.start?.toISOString().slice(0, 10), r.end?.toISOString().slice(0, 10)];

describe("sales time periods", () => {
  it("works out each preset as a [start, end) range of days", () => {
    expect(iso(periodRange("today", "", "", now))).toEqual(["2026-03-15", "2026-03-16"]);
    expect(iso(periodRange("7d", "", "", now))).toEqual(["2026-03-09", "2026-03-16"]);
    expect(iso(periodRange("last-month", "", "", now))).toEqual(["2026-02-01", "2026-03-01"]);
    expect(iso(periodRange("last-month", "", "", new Date("2026-01-10T00:00:00Z")))).toEqual(["2025-12-01", "2026-01-01"]);
    expect(iso(periodRange("this-year", "", "", now))).toEqual(["2026-01-01", "2027-01-01"]);
    expect(iso(periodRange("custom", "2026-02-03", "2026-02-05", now))).toEqual(["2026-02-03", "2026-02-06"]);
    expect(periodRange("custom", "junk", "", now)).toEqual({ start: undefined, end: undefined });
    expect(periodRange("all", "", "", now)).toEqual({});
  });

  it("names a range for file names", () => {
    expect(rangeSlug(periodRange("last-month", "", "", now))).toBe("2026-02-01-to-2026-02-28");
    expect(rangeSlug({})).toBe("all-time");
  });
});

describe("crosslist choices", () => {
  const rule = { percent: 10, round: "99" as const };
  it("prices each store", () => {
    expect(chosenPrice(2000, undefined, rule)).toBeUndefined();
    expect(chosenPrice(2000, { mode: "rule", percent: 0 }, rule)).toBeNull();
    expect(chosenPrice(2000, { mode: "match", percent: 0 }, rule)).toBe(2000);
    expect(chosenPrice(2000, { mode: "match", percent: 0 }, undefined)).toBeNull();
    expect(chosenPrice(2000, { mode: "percent", percent: -15 }, rule)).toBe(1700);
    expect(previewPrice(2000, { mode: "rule", percent: 0 }, rule)).toBe(2299);
    expect(withChoices({ priceCents: 5, title: "x" }, null)).toEqual({ title: "x" });
    expect(withChoices({}, 900, "Short")).toEqual({ priceCents: 900, title: "Short" });
  });

  it("cuts titles at a whole word", () => {
    expect(cutTitle("Blue denim jacket size large", 20)).toBe("Blue denim jacket");
    expect(cutTitle("Short", 20)).toBe("Short");
  });
});

describe("year-end profit and loss", () => {
  const m = (price: number, extra: Partial<SaleMoney> = {}): SaleMoney => ({
    price, shipping: 0, tax: 0, refund: 0, fees: 100, shippingCost: 0, cost: 200, other: 0,
    profit: price - 300, costKnown: true, feesEstimated: false, ...extra,
  });

  it("adds up a year by month and store", async () => {
    const pnl = summarizeYear(2026, [
      { soldAt: new Date("2026-01-05T00:00:00Z"), store: "eBay", money: m(1000) },
      { soldAt: new Date("2026-01-20T00:00:00Z"), store: "Etsy", money: m(3000, { costKnown: false }) },
      { soldAt: new Date("2026-12-31T23:00:00Z"), store: "eBay", money: m(500) },
      { soldAt: new Date("2025-12-31T23:00:00Z"), store: "eBay", money: m(9999) },
    ]);
    expect(pnl.total).toMatchObject({ orders: 3, sales: 4500, fees: 300, cogs: 600, profit: 3600 });
    expect(pnl.months[0].orders).toBe(2);
    expect(pnl.months[11].sales).toBe(500);
    expect(pnl.stores.map((s) => s.name)).toEqual(["Etsy", "eBay"]);
    expect(pnl.missingCost).toBe(1);
    expect(money(-123456)).toBe("($1,234.56)");

    const few = fewStores(["a", "b", "c", "d"].map((name) => ({ name, line: { ...pnl.total } })), 3);
    expect(few.map((s) => s.name)).toEqual(["a", "b", "Other stores"]);
    expect(few[2].line.sales).toBe(9000);

    const pdf = await pnlPdf(pnl, "Shop ✨ name");
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

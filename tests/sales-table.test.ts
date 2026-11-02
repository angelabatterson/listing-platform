import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "@/lib/csv";
import { parseDollars } from "@/lib/sale-fields";
import { parseSaleDate } from "@/lib/sales-import";
import { saleMoney, storeOrderLink } from "@/lib/sales-table";
import { scheduleTimes } from "@/lib/schedule";
import { makeConnection } from "./fixtures";

const sale = {
  priceCents: 5000,
  shippingCents: 800,
  taxCents: 400,
  refundCents: null,
  feesCents: 700,
  feesEstimated: false,
  shippingCostCents: null,
  costCents: null,
  otherCostCents: null,
  quantity: 2,
};

describe("a sale's profit", () => {
  it("uses the item's cost and the label's cost until the seller types their own", () => {
    expect(saleMoney(sale, 600, 950)).toMatchObject({ cost: 1200, shippingCost: 950, profit: 5000 + 800 - 700 - 950 - 1200, costKnown: true });
    const own = { ...sale, costCents: 300, shippingCostCents: 500, refundCents: 1000, otherCostCents: 100 };
    expect(saleMoney(own, 600, 950)).toMatchObject({ cost: 300, shippingCost: 500, profit: 5000 + 800 - 1000 - 700 - 500 - 300 - 100 });
  });

  it("says when nothing is known about the cost, and leaves sales tax out", () => {
    const m = saleMoney(sale, null, 0);
    expect(m).toMatchObject({ cost: 0, costKnown: false, tax: 400, profit: 5100 });
  });
});

describe("links to the order on the store", () => {
  it("opens the order itself on API stores", () => {
    expect(storeOrderLink(makeConnection({ environment: "production" }), "12-345", false)).toBe("https://www.ebay.com/sh/ord/details?orderid=12-345");
    expect(storeOrderLink(makeConnection({ marketplace: "etsy" }), "99", false)).toBe("https://www.etsy.com/your/orders/sold?order_id=99");
    expect(storeOrderLink(makeConnection({ marketplace: "shopify", settings: {} }), "1", false)).toBeNull();
  });

  it("opens the sold list for hand-added sales and extension stores", () => {
    expect(storeOrderLink(makeConnection({ environment: "production" }), "manual-x", true)).toBe("https://www.ebay.com/sh/ord");
    expect(storeOrderLink(makeConnection({ marketplace: "poshmark" }), "x", false)).toBe("https://poshmark.com/order/sales");
  });
});

describe("reading a spreadsheet", () => {
  it("reads back what toCsv writes, including quotes, commas, new lines and formula guards", () => {
    const rows = [
      ["Title", "Notes", "Amount"],
      ['Jacket, "vintage"', "line one\nline two", "-4.50"],
      ["=SUM(A1)", "", "+1"],
    ];
    expect(csvCell("-4.50")).toBe("'-4.50");
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("skips blank lines and a byte-order mark", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n,\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads amounts and dates the way people type them", () => {
    expect(parseDollars("$1,234.5")).toBe(123450);
    expect(parseDollars(" ")).toBeNull();
    expect(parseDollars("ten")).toBeUndefined();
    expect(parseDollars("-3")).toBeUndefined();
    expect(parseSaleDate("2026-10-31")?.toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(parseSaleDate("10/31/2026")?.toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(parseSaleDate("2026-02-30")).toBeNull();
    expect(parseSaleDate("soon")).toBeNull();
  });
});

describe("scheduling times", () => {
  const start = new Date(2026, 10, 3, 14, 0); // Nov 3, 2 pm local

  it("posts everything at the start time when all at once", () => {
    expect(scheduleTimes(3, { start, mode: "once", perDay: 1, fromHour: 9, toHour: 17 })).toEqual([start, start, start]);
  });

  it("spreads drafts evenly through the hours, starting from the start time", () => {
    const times = scheduleTimes(5, { start, mode: "spread", perDay: 4, fromHour: 9, toHour: 17 });
    const local = times.map((t) => `${t.getDate()} ${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`);
    // 9, 11, 13 and 15 o'clock; 9, 11 and 13 have already passed on the first day.
    expect(local).toEqual(["3 15:00", "4 9:00", "4 11:00", "4 13:00", "4 15:00"]);
  });
});

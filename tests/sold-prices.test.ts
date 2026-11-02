import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Sold from "@/lib/marketplaces/ebay/sold";

// A fresh module per test, so app tokens and eBay's refusals aren't remembered between tests.
let sold: typeof Sold;
const checkEbaySoldPrices: typeof Sold.checkEbaySoldPrices = (o) => sold.checkEbaySoldPrices(o);
const resetSoldAccess = () => sold.resetSoldAccess();
const summarizeSales: typeof Sold.summarizeSales = (r) => sold.summarizeSales(r);
const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

const sale = (value: string, title = "Levi's 501 jeans", currency = "USD") => ({
  title,
  lastSoldPrice: { value, currency },
  itemWebUrl: `https://www.ebay.com/itm/${title}-${value}`,
});

describe("sold prices", () => {
  const env = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    sold = await import("@/lib/marketplaces/ebay/sold");
    Object.assign(process.env, { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret", EBAY_RUNAME: "ru", EBAY_ENV: "production" });
    resetSoldAccess();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  const tokenOk = () =>
    fetchMock.mockResolvedValueOnce(Response.json({ access_token: "app-token", expires_in: 7200 }));

  it("summarizes the middle of what sold, in US dollars only", () => {
    const check = summarizeSales({ itemSales: [sale("10.00"), sale("20.00"), sale("30.00"), sale("40.00"), sale("99", "x", "GBP")] });
    expect(check).toMatchObject({ count: 4, lowCents: 1750, medianCents: 2500, highCents: 3250 });
    expect(summarizeSales({})).toBeNull();
  });

  it("asks Marketplace Insights with an app token for the right condition and category", async () => {
    tokenOk();
    fetchMock.mockResolvedValueOnce(Response.json({ itemSales: [sale("25.00")] }));
    const result = await checkEbaySoldPrices({ query: "Levi's 501", categoryId: "11483", isNew: false });
    expect(result).toMatchObject({ available: true, check: { count: 1, medianCents: 2500 } });
    expect(String(fetchMock.mock.calls[0][1].body)).toContain(encodeURIComponent(INSIGHTS_SCOPE));
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.pathname).toBe("/buy/marketplace_insights/v1_beta/item_sales/search");
    expect(url.searchParams.get("filter")).toBe("conditions:{USED}");
    expect(url.searchParams.get("category_ids")).toBe("11483");
  });

  it("says not available until eBay approves the app, without asking again right away", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "invalid_scope", error_description: "The requested scope is invalid" }, { status: 400 }));
    expect(await checkEbaySoldPrices({ query: "jeans", isNew: false })).toEqual({ available: false });
    expect(await checkEbaySoldPrices({ query: "jeans", isNew: false })).toEqual({ available: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a refused search as not available, and stays off in the eBay sandbox", async () => {
    tokenOk();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    expect(await checkEbaySoldPrices({ query: "jeans", isNew: true })).toEqual({ available: false });
    resetSoldAccess();
    process.env.EBAY_ENV = "sandbox";
    fetchMock.mockReset();
    expect(await checkEbaySoldPrices({ query: "jeans", isNew: true })).toEqual({ available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

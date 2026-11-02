import { describe, expect, it } from "vitest";
import { forStore } from "@/lib/marketplaces/overrides";
import { applyPriceRule, describeRule } from "@/lib/price-rules";
import { makeConnection, makeItem } from "./fixtures";

describe("store price rules", () => {
  it("raises or lowers by a percent and rounds", () => {
    expect(applyPriceRule(4000, { percent: 10, round: "none" })).toBe(4400);
    expect(applyPriceRule(4000, { percent: 10, round: "99" })).toBe(4499);
    expect(applyPriceRule(4550, { percent: -5, round: "whole" })).toBe(4300);
    expect(applyPriceRule(4000, { percent: 0, round: "none" })).toBe(4000);
    expect(applyPriceRule(4000, undefined)).toBe(4000);
    expect(describeRule({ percent: 10, round: "99" })).toBe("+10%, end in .99");
  });

  it("sets the store's price unless one was typed for that store", () => {
    const item = makeItem({ priceCents: 4000 });
    const posh = makeConnection({ marketplace: "poshmark", settings: { priceRule: { percent: 10, round: "99" } } });
    expect(forStore(item, { overrides: {} }, posh).priceCents).toBe(4499);
    expect(forStore(item, { overrides: { priceCents: 3500 } }, posh).priceCents).toBe(3500);
    expect(forStore(item, { overrides: {} }).priceCents).toBe(4000);
  });
});

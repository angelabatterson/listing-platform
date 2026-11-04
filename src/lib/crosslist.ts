// Choices from the "Crosslist items" pop-up on Inventory.
import { z } from "zod";
import type { ListingOverrides } from "@/db/schema";
import { applyPriceRule, hasRule, type PriceRule } from "@/lib/price-rules";

export const crosslistPriceSchema = z.object({
  // rule: the store's price rule (or the main price); match: the main price exactly;
  // percent: the main price raised (or lowered, when negative) by `percent`.
  mode: z.enum(["rule", "match", "percent"]),
  percent: z.number().min(-90).max(500),
});
export type CrosslistPrice = z.infer<typeof crosslistPriceSchema>;

export const crosslistOptionsSchema = z.object({
  shortenTitles: z.boolean().default(false),
  prices: z.record(z.uuid(), crosslistPriceSchema).default({}),
  publish: z.boolean().default(true),
});
export type CrosslistOptions = z.input<typeof crosslistOptionsSchema>;

// The store price a choice gives, or null when the store should follow its price rule.
export function chosenPrice(mainCents: number, choice: CrosslistPrice | undefined, rule: PriceRule | undefined): number | null | undefined {
  if (!choice) return undefined; // leave whatever is set now
  if (choice.mode === "rule") return null;
  if (choice.mode === "match") return hasRule(rule) ? mainCents : null;
  return Math.max(1, Math.round(mainCents * (1 + choice.percent / 100)));
}

// The listing's overrides with the chosen price and title.
export function withChoices(overrides: ListingOverrides, price: number | null | undefined, title?: string): ListingOverrides {
  const next = { ...overrides };
  if (price === null) delete next.priceCents;
  else if (price !== undefined) next.priceCents = price;
  if (title) next.title = title;
  return next;
}

// What the store will charge, for the pop-up's preview.
export function previewPrice(mainCents: number, choice: CrosslistPrice, rule: PriceRule | undefined): number {
  const p = chosenPrice(mainCents, choice, rule);
  return p ?? applyPriceRule(mainCents, rule);
}

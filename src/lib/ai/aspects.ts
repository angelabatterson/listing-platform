import { z } from "zod";
import type { ItemAttributes } from "@/db/schema";
import type { EbayAspect } from "@/lib/marketplaces/ebay/taxonomy";

export const aspectsSchema = z.object({
  aspects: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
});

export const ASPECTS_SYSTEM = `You fill in eBay item specifics for a reseller's listing. You get the listing so far, the item's photos when there are any, and the specifics eBay asks for in the chosen category.

Fill in every specific you can determine from the photos and the listing text. Use the exact specific names given. When a specific lists allowed values, use one of those values exactly as written. Only say what you can actually see or read; leave out anything you would have to guess, even if it is required. Never answer "Unknown", "N/A" or "Does not apply" unless that is genuinely correct for the item and is an allowed value.`;

// Long pick lists are cut down to keep the request small; free-text aspects
// still accept anything, and pick-only values are checked afterwards.
const VALUES_SHOWN = 60;

export function describeAspects(aspects: EbayAspect[], current: ItemAttributes): string {
  const have = new Set(Object.keys(current).map((k) => k.toLowerCase()));
  return aspects
    .filter((a) => (a.required || a.recommended) && !have.has(a.name.toLowerCase()))
    .map((a) => {
      const tags = [a.required ? "required" : "recommended", a.multiple ? "several values allowed" : "one value"];
      const values = a.values.length
        ? `; ${a.selectionOnly ? "allowed values" : "common values"}: ${a.values.slice(0, VALUES_SHOWN).join(" | ")}`
        : "";
      return `- ${a.name} (${tags.join(", ")}${values})`;
    })
    .join("\n");
}

// Add the AI's answers to what the seller already has. The seller's values win.
export function mergeAspects(current: ItemAttributes, answers: z.infer<typeof aspectsSchema>): ItemAttributes {
  const merged: ItemAttributes = { ...current };
  const have = new Set(Object.keys(current).map((k) => k.toLowerCase()));
  for (const { name, values } of answers.aspects) {
    const cleaned = values.map((v) => v.trim()).filter((v) => v && !/^(unknown|n\/a)$/i.test(v));
    if (name.trim() && cleaned.length && !have.has(name.trim().toLowerCase())) merged[name.trim()] = cleaned;
  }
  return merged;
}

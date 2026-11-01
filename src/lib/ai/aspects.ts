import { z } from "zod";
import type { ItemAttributes } from "@/db/schema";
import type { EbayAspect } from "@/lib/marketplaces/ebay/taxonomy";

export const aspectsSchema = z.object({
  aspects: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
});

export const ASPECTS_SYSTEM = `You fill in eBay item specifics for a reseller's listing. You get the listing so far, the item's photos when there are any, and the specifics eBay asks for in the chosen category.

Fill in every specific you can determine from the photos and the listing text, optional ones too: more filled-in specifics help buyers find the listing. Use the exact specific names given. When a specific lists allowed values, use one of those values exactly as written. Say what you can see or read, or tell reliably from the item itself (for example Sleeve Length, Neckline, Closure, Occasion or Season of a shirt you can see); leave out anything you would have to guess, such as a size with no tag, even if it is required. Never answer "Unknown", "N/A" or "Does not apply" unless that is genuinely correct for the item and is an allowed value.`;

// Long pick lists are cut down to keep the request small; free-text aspects
// still accept anything, and pick-only values are checked afterwards.
const VALUES_SHOWN = 60;

// Most categories list 20 to 60 specifics; asking about too many makes the AI slower and
// less careful, so optional ones are added only up to this many in all.
const ASPECTS_ASKED = 40;

export function describeAspects(aspects: EbayAspect[], current: ItemAttributes): string {
  const have = new Set(Object.keys(current).map((k) => k.toLowerCase()));
  const rank = (a: EbayAspect) => (a.required ? 0 : a.recommended ? 1 : 2);
  const missing = aspects.filter((a) => !have.has(a.name.toLowerCase())).sort((a, b) => rank(a) - rank(b));
  return missing
    .filter((a, i) => rank(a) < 2 || i < ASPECTS_ASKED)
    .map((a) => {
      const tags = [["required", "recommended", "optional"][rank(a)], a.multiple ? "several values allowed" : "one value"];
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

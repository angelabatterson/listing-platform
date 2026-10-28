import { z } from "zod";
import type { DraftNotes, ItemAttributes } from "@/db/schema";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { ETSY_WHEN_MADE } from "@/lib/marketplaces/etsy/config";

const conditionValues = EBAY_CONDITIONS.map((c) => c.value) as [string, ...string[]];
const whenMadeValues = ETSY_WHEN_MADE.map((w) => w.value) as [string, ...string[]];

export const draftSchema = z.object({
  title: z.string().describe("At most 80 characters."),
  description: z.string(),
  condition: z.enum(conditionValues),
  brand: z.string().nullable().describe("Only if a label, logo or tag shows it; otherwise null."),
  itemSpecifics: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  categoryQuery: z.string().describe("A short phrase to search eBay's category tree, e.g. 'women's denim jacket'."),
  suggestedPrice: z.number().describe("Suggested Buy It Now price in US dollars."),
  priceNote: z.string().describe("One sentence on how the price was chosen."),
  whenMade: z.enum(whenMadeValues).describe("When the item was made, in Etsy's ranges."),
});

export type Draft = z.infer<typeof draftSchema>;

export const DRAFT_SYSTEM = `You write marketplace listings for a reseller who sells on eBay and Etsy. You get the photos of one item and return a ready-to-review draft.

Title: at most 80 characters. Lead with the brand (if known), then what the item is, then the details buyers search for: model or style, size, colour, material, era. Use plain words buyers type into search. No ALL CAPS, emoji, or filler such as "L@@K", "rare" or "must see".

Description: a few short paragraphs in plain text. Say what the item is, its measurements or size if a tag shows it, materials, and its condition. Mention every flaw you can see (stains, wear, chips, missing parts). Do not invent facts that the photos don't show; if something important can't be seen, such as whether electronics work, say it hasn't been checked.

Condition: pick the closest eBay condition. Only choose a NEW condition when tags, packaging or the photos clearly show it is unused.

Brand: only when a label, logo, tag or marking in the photos shows it. Otherwise null.

Item specifics: the facts eBay asks for in this kind of category, as name and values, using eBay's usual names (Brand, Type, Department, Size, Size Type, Color, Material, Style, Pattern, Model, Era, Country of Origin, and so on). Only include values you can read or see. Keep each value under 65 characters.

Price: a realistic Buy It Now price in US dollars for this item in this condition on eBay today, based on what similar items usually sell for. The seller will check it, so give your honest best estimate and say briefly how you got it.

When made: the closest Etsy range. Use the era clues you can see; for ordinary recent goods use "2020_2026" or "2010_2019".`;

const ASPECT_NAME_MAX = 40;
const ASPECT_VALUE_MAX = 65;
const TITLE_MAX = 80;

// What a draft becomes on the item. Everything here is editable before listing.
export function draftToItem(draft: Draft): {
  title: string;
  description: string;
  condition: string;
  brand: string | null;
  priceCents: number;
  attributes: ItemAttributes;
  draftNotes: DraftNotes;
} {
  const attributes: ItemAttributes = {};
  for (const { name, values } of draft.itemSpecifics) {
    const key = name.trim().slice(0, ASPECT_NAME_MAX);
    const cleaned = values.map((v) => v.trim().slice(0, ASPECT_VALUE_MAX)).filter(Boolean);
    if (key && cleaned.length) attributes[key] = [...new Set([...(attributes[key] ?? []), ...cleaned])];
  }
  const brand = draft.brand?.trim() || null;
  return {
    title: draft.title.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX).trim(),
    description: draft.description.trim(),
    condition: draft.condition,
    brand,
    priceCents: Math.max(100, Math.round(draft.suggestedPrice * 100)),
    attributes,
    draftNotes: {
      categoryQuery: draft.categoryQuery.trim(),
      priceNote: draft.priceNote.trim(),
      whenMade: draft.whenMade,
    },
  };
}

// SKUs for drafted items: batch number, then the item's place in the batch ("B12-3").
export function batchSku(batchNumber: number, index: number): string {
  return `B${batchNumber}-${index + 1}`;
}

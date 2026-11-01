import { z } from "zod";
import type { DraftNotes, DraftSettings, ItemAttributes } from "@/db/schema";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { ETSY_WHEN_MADE } from "@/lib/marketplaces/etsy/config";
import { titleOrderInstruction } from "./title-order";

const conditionValues = EBAY_CONDITIONS.map((c) => c.value) as [string, ...string[]];
const whenMadeValues = ETSY_WHEN_MADE.map((w) => w.value) as [string, ...string[]];

export const draftSchema = z.object({
  title: z.string().describe("At most 80 characters."),
  longTitle: z.string().describe("The same title with extra search words, at most 140 characters, for stores that allow longer titles."),
  description: z.string(),
  condition: z.enum(conditionValues),
  brand: z.string().nullable().describe("Only if a label, logo or tag shows it; otherwise null."),
  itemSpecifics: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  categoryQuery: z.string().describe("A short phrase to search eBay's category tree, e.g. 'women's denim jacket'."),
  suggestedPrice: z.number().describe("Suggested Buy It Now price in US dollars."),
  priceNote: z.string().describe("One sentence on how the price was chosen."),
  whenMade: z.enum(whenMadeValues).describe("When the item was made, in Etsy's ranges."),
  skuOnPhoto: z
    .string()
    .nullable()
    .describe("The seller's own inventory code (SKU) when a sticker, tag or card in the photos shows one; otherwise null."),
  skuPhoto: z
    .number()
    .int()
    .nullable()
    .describe("The number of the photo that only shows that SKU sticker or card (not the item), or null."),
});

export type Draft = z.infer<typeof draftSchema>;

const DRAFT_BASE = `You write marketplace listings for a reseller who sells on eBay and Etsy. You get the photos of one item and return a ready-to-review draft.

Title: at most 80 characters. Lead with the brand (if known), then what the item is, then the details buyers search for: model or style, size, colour, material, era. Use plain words buyers type into search. No ALL CAPS, emoji, or filler such as "L@@K", "rare" or "must see".

Description: a few short paragraphs in plain text. Say what the item is, its measurements or size if a tag shows it, materials, and its condition. Mention every flaw you can see (stains, wear, chips, missing parts). Do not invent facts that the photos don't show; if something important can't be seen, such as whether electronics work, say it hasn't been checked.

Condition: pick the closest eBay condition. Only choose a NEW condition when tags, packaging or the photos clearly show it is unused.

Brand: only when a label, logo, tag or marking in the photos shows it. Otherwise null.

Long title: the same title with more of the words buyers search for, at most 140 characters, for stores like Etsy that allow longer titles. Keep the same word order.

Item specifics: the facts eBay asks for in this kind of category, as name and values, using eBay's usual names (Brand, Type, Department, Size, Size Type, Color, Material, Style, Pattern, Model, Era, Country of Origin, Fit, Sleeve Length, Neckline, Closure, Features, Occasion, Season, Theme, Vintage, Character, and so on). Fill in as many as you can read, see, or reliably tell from the item itself, usually 15 to 25 for clothing and shoes. Don't guess at things you can't tell, such as a size with no tag. Keep each value under 65 characters.

Price: a realistic Buy It Now price in US dollars for this item in this condition on eBay today, based on what similar items usually sell for. The seller will check it, so give your honest best estimate and say briefly how you got it.

When made: the closest Etsy range. Use the era clues you can see; for ordinary recent goods use "2020_2026" or "2010_2019".`;

const SKU_RULES = `Seller's SKU: resellers often photograph a sticker, tag or card with their own inventory code (for example "A123", "BIN4-017" or "2611-05"), separate from the item. If one is shown, return it exactly as written in skuOnPhoto, and if a photo shows only that code and not the item, return that photo's number in skuPhoto. Brand style numbers, barcodes and prices on the item's own tags are not the seller's SKU. If there's no such code, return null for both.`;

// The instructions for writing a draft, with the seller's own title order.
export function draftSystem(settings: DraftSettings = {}): string {
  const sku = settings.skuFromPhoto === false ? "Seller's SKU: always return null for skuOnPhoto and skuPhoto." : SKU_RULES;
  return [DRAFT_BASE, `Title order: ${titleOrderInstruction(settings.titleOrder)}`, sku].join("\n\n");
}

const ASPECT_NAME_MAX = 40;
const ASPECT_VALUE_MAX = 65;
const TITLE_MAX = 80;
const LONG_TITLE_MAX = 140;
const SKU_MAX = 50;

// Cut a title to `max` characters at a word break.
export function fitTitle(title: string, max: number): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : clean.slice(0, max)).trim();
}

// What a draft becomes on the item. Everything here is editable before listing.
export function draftToItem(
  draft: Draft,
  photoCount = Infinity,
): {
  title: string;
  // A longer title for stores that allow one (Etsy), or null when it's the same.
  longTitle: string | null;
  // The seller's SKU read off a photo, and the photo (0-based) to keep off the listing.
  ownSku: string | null;
  skuPhoto: number | null;
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
  const title = fitTitle(draft.title, TITLE_MAX);
  const longTitle = fitTitle(draft.longTitle || "", LONG_TITLE_MAX);
  const ownSku = draft.skuOnPhoto?.trim().replace(/\s+/g, "-").slice(0, SKU_MAX) || null;
  const skuPhoto =
    ownSku && draft.skuPhoto !== null && draft.skuPhoto >= 1 && draft.skuPhoto <= photoCount && photoCount > 1
      ? draft.skuPhoto - 1
      : null;
  return {
    title,
    longTitle: longTitle.length > title.length ? longTitle : null,
    ownSku,
    skuPhoto,
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

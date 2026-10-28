import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { photos, type Connection, type ItemAttributes } from "@/db/schema";
import {
  conformToAspects,
  fetchEbayAspects,
  suggestEbayCategories,
  type EbayAspect,
} from "@/lib/marketplaces/ebay/taxonomy";
import { ASPECTS_SYSTEM, aspectsSchema, describeAspects, mergeAspects } from "./aspects";
import { askForJson, jpegBlock } from "./client";

const PHOTOS_FOR_ASPECTS = 6;

export async function itemPhotoBytes(itemId: string, limit = PHOTOS_FOR_ASPECTS): Promise<Buffer[]> {
  const rows = await db
    .select({ data: photos.data })
    .from(photos)
    .where(eq(photos.itemId, itemId))
    .orderBy(asc(photos.position))
    .limit(limit);
  return rows.map((r) => r.data);
}

// Ask the AI for the category's missing specifics and return the item's specifics
// with them added, trimmed to what eBay accepts.
export async function fillEbayAspects(options: {
  connection: Connection;
  categoryId: string;
  item: { title: string; description: string; brand: string | null; attributes: ItemAttributes };
  photos: Buffer[];
  aspects?: EbayAspect[];
}): Promise<ItemAttributes> {
  const aspects = options.aspects ?? (await fetchEbayAspects(options.connection, options.categoryId));
  const current = { ...options.item.attributes };
  if (options.item.brand && !Object.keys(current).some((k) => k.toLowerCase() === "brand")) {
    current.Brand = [options.item.brand];
  }
  const wanted = describeAspects(aspects, current);
  if (!wanted) return conformToAspects(current, aspects);

  const answers = await askForJson({
    schema: aspectsSchema,
    system: ASPECTS_SYSTEM,
    content: [
      ...options.photos.map(jpegBlock),
      {
        type: "text",
        text: [
          `Title: ${options.item.title}`,
          `Description:\n${options.item.description}`,
          `Specifics already filled in:\n${Object.entries(current).map(([k, v]) => `- ${k}: ${v.join(", ")}`).join("\n") || "(none)"}`,
          `Specifics to fill in:\n${wanted}`,
        ].join("\n\n"),
      },
    ],
    effort: "low",
    maxTokens: 8000,
  });
  return conformToAspects(mergeAspects(current, answers), aspects);
}

// Right after drafting: take eBay's top category for the AI's search phrase and
// fill that category's specifics, so the seller only has to check them.
export async function autoCategorizeForEbay(options: {
  connection: Connection;
  query: string;
  item: { title: string; description: string; brand: string | null; attributes: ItemAttributes };
  photos: Buffer[];
}): Promise<{ categoryId: string; attributes: ItemAttributes } | null> {
  const [best] = await suggestEbayCategories(options.connection, options.query || options.item.title);
  if (!best) return null;
  const attributes = await fillEbayAspects({ ...options, categoryId: best.id });
  return { categoryId: best.id, attributes };
}

"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections, items } from "@/db/schema";
import { fillEbayAspects, itemPhotoBytes } from "@/lib/ai/assist";
import { AiError } from "@/lib/ai/client";
import { requireUser } from "@/lib/auth";
import { writeProblem } from "@/lib/billing/access";
import { checkEbayPrices, type PriceCheck } from "@/lib/marketplaces/ebay/browse";
import { EbayApiError } from "@/lib/marketplaces/ebay/client";
import { EtsyApiError } from "@/lib/marketplaces/etsy/client";
import {
  fetchEbayAspects,
  missingRequiredAspects,
  suggestEbayCategories,
  type CategoryOption,
} from "@/lib/marketplaces/ebay/taxonomy";
import { suggestEtsyCategories } from "@/lib/marketplaces/etsy/taxonomy";
import { formatSpecifics, parseSpecifics } from "@/lib/specifics";

type Result<T> = ({ error?: undefined } & T) | { error: string };

// Errors whose message is written for the seller; anything else (like a network
// failure) gets a plain retry message.
class Notice extends Error {}

function failure(err: unknown): { error: string } {
  const shown = [Notice, AiError, EbayApiError, EtsyApiError].some((type) => err instanceof type);
  if (shown || (err instanceof Error && err.message.startsWith("Reconnect"))) return { error: (err as Error).message };
  console.error(err);
  return { error: "Couldn't reach the store just now. Try again in a minute." };
}

async function ownConnection(connectionId: string) {
  const user = await requireUser();
  const blocked = await writeProblem(user);
  if (blocked) throw new Notice(blocked);
  const connection = await db.query.connections.findFirst({
    where: and(eq(connections.id, connectionId), eq(connections.organizationId, user.organizationId)),
  });
  if (!connection || connection.status !== "active") throw new Notice("Reconnect this store on the Stores page first.");
  return { user, connection };
}

export async function findCategories(connectionId: string, query: string): Promise<Result<{ options: CategoryOption[] }>> {
  if (!query.trim()) return { error: "Type a few words describing the item." };
  try {
    const { connection } = await ownConnection(connectionId);
    const options =
      connection.marketplace === "ebay"
        ? await suggestEbayCategories(connection, query)
        : await suggestEtsyCategories(connection, query);
    return { options };
  } catch (err) {
    return failure(err);
  }
}

export async function checkCategorySpecifics(
  connectionId: string,
  categoryId: string,
  specifics: string,
  brand: string,
): Promise<Result<{ missing: string[]; recommended: string[] }>> {
  try {
    const { connection } = await ownConnection(connectionId);
    const aspects = await fetchEbayAspects(connection, categoryId);
    const attributes = parseSpecifics(specifics);
    const have = new Set(Object.keys(attributes).map((k) => k.toLowerCase()));
    return {
      missing: missingRequiredAspects(aspects, attributes, brand.trim() || null),
      recommended: aspects.filter((a) => a.recommended && !have.has(a.name.toLowerCase())).map((a) => a.name),
    };
  } catch (err) {
    return failure(err);
  }
}

// Fill the eBay category's item specifics from the item's photos and text. Works on
// what's in the form, so unsaved edits are used and nothing is saved until Save.
export async function fillSpecifics(
  itemId: string | null,
  connectionId: string,
  categoryId: string,
  form: { title: string; description: string; brand: string; specifics: string },
): Promise<Result<{ specifics: string }>> {
  try {
    const { user, connection } = await ownConnection(connectionId);
    let photoBytes: Buffer[] = [];
    if (itemId) {
      const item = await db.query.items.findFirst({
        where: and(eq(items.id, itemId), eq(items.organizationId, user.organizationId)),
        columns: { id: true },
      });
      if (item) photoBytes = await itemPhotoBytes(item.id);
    }
    const attributes = await fillEbayAspects({
      connection,
      categoryId,
      item: {
        title: form.title,
        description: form.description,
        brand: form.brand.trim() || null,
        attributes: parseSpecifics(form.specifics),
      },
      photos: photoBytes,
    });
    return { specifics: formatSpecifics(attributes) };
  } catch (err) {
    return failure(err);
  }
}

export async function checkPrices(
  connectionId: string,
  query: string,
  categoryId: string,
  condition: string,
): Promise<Result<{ check: PriceCheck | null }>> {
  if (!query.trim()) return { error: "Add a title first." };
  try {
    const { connection } = await ownConnection(connectionId);
    const check = await checkEbayPrices(connection, {
      query,
      categoryId: categoryId || undefined,
      isNew: condition.startsWith("NEW"),
    });
    return { check };
  } catch (err) {
    return failure(err);
  }
}

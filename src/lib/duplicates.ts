import "server-only";
import { asc, and, eq, inArray, ne } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { itemImages, items } from "@/db/schema";

// Possible duplicates in an account: items with the same or nearly the same title, SKUs
// that differ only by punctuation or leading zeros, or the same photo. The seller can
// mark an item "Not a duplicate" to leave it out.

const STOP = new Set(["the", "and", "for", "with", "a", "an", "of", "in", "on", "to", "by", "new", "nwt", "nwot", "size", "womens", "mens", "women", "men"]);

export function titleWords(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(words)];
}

// "JLTBD-02", "jltbd_2" and "JLTBD 2" are the same SKU to a person.
export function skuKey(sku: string): string {
  return sku
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((part) => (/^\d+$/.test(part) ? String(Number(part)) : part))
    .join("-");
}

// How alike two titles are, from 0 to 1 (shared words over all words).
export function titleLikeness(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  const shared = b.filter((w) => set.has(w)).length;
  return shared / (a.length + b.length - shared);
}

export const LIKENESS = 0.75;
const COMMON_WORD = 200;

export type DuplicateCandidate = { id: string; title: string; sku: string; photos: string[] };
export type DuplicateMatch = { otherId: string; otherTitle: string; reason: "title" | "sku" | "photo" };

// Pairs each item with the most likely duplicate it has, if any.
export function matchDuplicates(list: DuplicateCandidate[]): Map<string, DuplicateMatch> {
  const words = list.map((i) => titleWords(i.title));
  const found = new Map<string, DuplicateMatch>();
  const note = (a: number, b: number, reason: DuplicateMatch["reason"]) => {
    if (!found.has(list[a].id)) found.set(list[a].id, { otherId: list[b].id, otherTitle: list[b].title, reason });
    if (!found.has(list[b].id)) found.set(list[b].id, { otherId: list[a].id, otherTitle: list[a].title, reason });
  };
  const byKey = (key: (i: DuplicateCandidate, n: number) => string[], reason: DuplicateMatch["reason"]) => {
    const seen = new Map<string, number>();
    list.forEach((item, n) => {
      for (const k of key(item, n)) {
        if (!k) continue;
        const first = seen.get(k);
        if (first === undefined) seen.set(k, n);
        else if (list[first].id !== item.id) note(first, n, reason);
      }
    });
  };
  byKey((i) => [skuKey(i.sku)], "sku");
  byKey((i) => i.photos, "photo");
  byKey((_, n) => [words[n].slice().sort().join(" ")], "title");

  // Nearly the same title: compare only items that share an uncommon word.
  const index = new Map<string, number[]>();
  words.forEach((ws, n) => ws.forEach((w) => index.set(w, [...(index.get(w) ?? []), n])));
  words.forEach((ws, a) => {
    if (ws.length < 3) return;
    const seen = new Set<number>();
    for (const w of ws) {
      const posting = index.get(w)!;
      if (posting.length > COMMON_WORD) continue;
      for (const b of posting) {
        if (b <= a || seen.has(b)) continue;
        seen.add(b);
        if (words[b].length >= 3 && titleLikeness(ws, words[b]) >= LIKENESS) note(a, b, "title");
      }
    }
  });
  return found;
}

// Each item that has a possible duplicate, for the Inventory Duplicates tab.
export const duplicatesFor = cache(async (orgId: string): Promise<Map<string, DuplicateMatch>> => {
  const rows = await db
    .select({ id: items.id, title: items.title, sku: items.sku })
    .from(items)
    .where(and(eq(items.organizationId, orgId), ne(items.status, "archived"), eq(items.notDuplicate, false)))
    .orderBy(asc(items.createdAt));
  if (rows.length < 2) return new Map();
  const photos = await db
    .select({ itemId: itemImages.itemId, url: itemImages.url })
    .from(itemImages)
    .where(inArray(itemImages.itemId, rows.map((r) => r.id)));
  const byItem = new Map<string, string[]>();
  for (const p of photos) byItem.set(p.itemId, [...(byItem.get(p.itemId) ?? []), p.url]);
  return matchDuplicates(rows.map((r) => ({ ...r, photos: byItem.get(r.id) ?? [] })));
});

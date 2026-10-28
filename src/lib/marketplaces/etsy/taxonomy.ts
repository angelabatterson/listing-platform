import type { Connection } from "@/db/schema";
import type { CategoryOption } from "../ebay/taxonomy";
import { etsyFetch } from "./client";

type TaxonomyNode = { id: number; name: string; children?: TaxonomyNode[] };

// Etsy lists can only go in a leaf category, so flatten the tree to its leaves.
export function leafCategories(nodes: TaxonomyNode[], parents: string[] = []): CategoryOption[] {
  return nodes.flatMap((node) => {
    const path = [...parents, node.name];
    return node.children?.length
      ? leafCategories(node.children, path)
      : [{ id: String(node.id), name: node.name, path: path.join(" > ") }];
  });
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/(ies|es|s)$/, ""));

// Rank leaves by how many search words appear in their name (counted double) or path.
export function rankCategories(leaves: CategoryOption[], query: string, limit = 8): CategoryOption[] {
  const terms = [...new Set(words(query))];
  if (terms.length === 0) return [];
  return leaves
    .map((leaf) => {
      const name = new Set(words(leaf.name));
      const path = new Set(words(leaf.path));
      const score = terms.reduce((sum, t) => sum + (name.has(t) ? 2 : path.has(t) ? 1 : 0), 0);
      return { leaf, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.leaf.path.length - b.leaf.path.length)
    .slice(0, limit)
    .map((r) => r.leaf);
}

let cache: { leaves: CategoryOption[]; at: number } | undefined;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function suggestEtsyCategories(connection: Connection, query: string): Promise<CategoryOption[]> {
  if (!cache || Date.now() - cache.at > DAY_MS) {
    const { results } = await etsyFetch<{ results: TaxonomyNode[] }>(connection, "/v3/application/seller-taxonomy/nodes");
    cache = { leaves: leafCategories(results), at: Date.now() };
  }
  return rankCategories(cache.leaves, query);
}

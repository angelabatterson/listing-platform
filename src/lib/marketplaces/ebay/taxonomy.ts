import type { Connection, ItemAttributes } from "@/db/schema";
import { ebayFetch } from "./client";
import { DEFAULT_MARKETPLACE_ID } from "./config";

export type CategoryOption = { id: string; name: string; path: string };

export type EbayAspect = {
  name: string;
  required: boolean;
  recommended: boolean;
  // SELECTION_ONLY aspects only accept one of `values`.
  selectionOnly: boolean;
  multiple: boolean;
  values: string[];
};

type CategorySuggestions = {
  categorySuggestions?: {
    category: { categoryId: string; categoryName: string };
    categoryTreeNodeAncestors?: { categoryName: string; categoryTreeNodeLevel: number }[];
  }[];
};

type ItemAspects = {
  aspects?: {
    localizedAspectName: string;
    aspectConstraint: {
      aspectRequired?: boolean;
      aspectUsage?: string;
      aspectMode?: string;
      itemToAspectCardinality?: string;
    };
    aspectValues?: { localizedValue: string }[];
  }[];
};

const treeIds = new Map<string, string>();

async function categoryTreeId(connection: Connection): Promise<string> {
  const marketplaceId = connection.settings.marketplaceId ?? DEFAULT_MARKETPLACE_ID;
  const cached = treeIds.get(marketplaceId);
  if (cached) return cached;
  const { categoryTreeId } = await ebayFetch<{ categoryTreeId: string }>(
    connection,
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`,
  );
  treeIds.set(marketplaceId, categoryTreeId);
  return categoryTreeId;
}

export function toCategoryOptions(response: CategorySuggestions): CategoryOption[] {
  return (response.categorySuggestions ?? []).map(({ category, categoryTreeNodeAncestors = [] }) => {
    const ancestors = [...categoryTreeNodeAncestors]
      .sort((a, b) => a.categoryTreeNodeLevel - b.categoryTreeNodeLevel)
      .map((a) => a.categoryName);
    return {
      id: category.categoryId,
      name: category.categoryName,
      path: [...ancestors, category.categoryName].join(" > "),
    };
  });
}

// eBay's own suggestions for a search phrase, best match first.
export async function suggestEbayCategories(connection: Connection, query: string): Promise<CategoryOption[]> {
  const treeId = await categoryTreeId(connection);
  const response = await ebayFetch<CategorySuggestions>(
    connection,
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(query)}`,
  );
  return toCategoryOptions(response).slice(0, 8);
}

export function toAspects(response: ItemAspects): EbayAspect[] {
  return (response.aspects ?? []).map((a) => ({
    name: a.localizedAspectName,
    required: Boolean(a.aspectConstraint.aspectRequired),
    recommended: a.aspectConstraint.aspectUsage === "RECOMMENDED",
    selectionOnly: a.aspectConstraint.aspectMode === "SELECTION_ONLY",
    multiple: a.aspectConstraint.itemToAspectCardinality === "MULTI",
    values: (a.aspectValues ?? []).map((v) => v.localizedValue),
  }));
}

// The item specifics eBay asks for in a category, required ones first.
export async function fetchEbayAspects(connection: Connection, categoryId: string): Promise<EbayAspect[]> {
  const treeId = await categoryTreeId(connection);
  const response = await ebayFetch<ItemAspects>(
    connection,
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
  );
  return toAspects(response);
}

export function missingRequiredAspects(aspects: EbayAspect[], attributes: ItemAttributes, brand: string | null): string[] {
  const have = new Set(Object.keys(attributes).map((k) => k.toLowerCase()));
  if (brand) have.add("brand");
  return aspects.filter((a) => a.required && !have.has(a.name.toLowerCase())).map((a) => a.name);
}

// Keep only values eBay will accept: one per single-value aspect, and only listed
// values for aspects that are pick-from-a-list.
export function conformToAspects(attributes: ItemAttributes, aspects: EbayAspect[]): ItemAttributes {
  const byName = new Map(aspects.map((a) => [a.name.toLowerCase(), a]));
  const result: ItemAttributes = {};
  for (const [name, values] of Object.entries(attributes)) {
    const aspect = byName.get(name.toLowerCase());
    if (!aspect) {
      result[name] = values;
      continue;
    }
    let kept = values;
    if (aspect.selectionOnly && aspect.values.length) {
      const allowed = new Map(aspect.values.map((v) => [v.toLowerCase(), v]));
      kept = values.map((v) => allowed.get(v.toLowerCase())).filter((v): v is string => Boolean(v));
    }
    if (!aspect.multiple) kept = kept.slice(0, 1);
    if (kept.length) result[aspect.name] = kept;
  }
  return result;
}

// The parts a listing title is built from, in the order most resellers use. Sellers
// can reorder them or switch some off (Photo batches > Draft settings).
export const TITLE_PARTS = [
  { key: "brand", label: "Brand", hint: "brand or maker" },
  { key: "department", label: "Men's / Women's / Kids'", hint: "who it's for, e.g. Women's" },
  { key: "type", label: "What it is", hint: "the item type, e.g. Denim Jacket" },
  { key: "model", label: "Style or model", hint: "style, model or line name" },
  { key: "size", label: "Size", hint: "size from the tag, e.g. Size M" },
  { key: "color", label: "Color", hint: "main color" },
  { key: "material", label: "Material", hint: "main material, e.g. Wool" },
  { key: "pattern", label: "Pattern", hint: "pattern, e.g. Plaid" },
  { key: "era", label: "Era or vintage", hint: "era, e.g. Vintage 90s" },
  { key: "features", label: "Key features", hint: "notable features buyers search for" },
  { key: "condition", label: "Condition words", hint: "e.g. NWT or New, only when true" },
] as const;

export type TitlePartKey = (typeof TITLE_PARTS)[number]["key"];

export const DEFAULT_TITLE_ORDER: TitlePartKey[] = ["brand", "department", "type", "model", "size", "color", "material", "pattern", "era", "features"];

const known = new Set<string>(TITLE_PARTS.map((p) => p.key));

// The seller's order, or the default when they haven't set one. Unknown keys are dropped.
export function titleOrder(saved: string[] | undefined): TitlePartKey[] {
  const order = (saved ?? []).filter((k): k is TitlePartKey => known.has(k));
  return order.length ? [...new Set(order)] : DEFAULT_TITLE_ORDER;
}

// The line added to the AI's instructions so titles follow the seller's order.
export function titleOrderInstruction(saved: string[] | undefined): string {
  const parts = titleOrder(saved).map((k) => TITLE_PARTS.find((p) => p.key === k)!);
  return `Build every title from these parts, in exactly this order, skipping any you can't tell from the photos: ${parts
    .map((p, i) => `${i + 1}. ${p.label} (${p.hint})`)
    .join("; ")}. Don't add parts that aren't in this list.`;
}

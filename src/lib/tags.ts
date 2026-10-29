export const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

// "Bin 4, women's denim,  bin 4" → ["Bin 4", "women's denim"]: trimmed, de-duplicated
// ignoring case (the first spelling wins), and capped so one item can't hold hundreds.
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(",")) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

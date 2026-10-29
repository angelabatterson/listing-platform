// A live listing read from a store, in Relistic's terms, ready to import.
export type ImportedListing = {
  remoteListingId: string;
  sku: string | null;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  quantity: number;
  condition?: string;
  brand?: string | null;
  attributes?: Record<string, string[]>;
  photos: string[];
  overrides: { categoryId?: string; whenMade?: string };
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

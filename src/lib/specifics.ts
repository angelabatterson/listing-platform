import type { ItemAttributes } from "@/db/schema";

// Item specifics are edited as text, one per line: "Size: M" or "Material: Cotton, Polyester".

export function formatSpecifics(attributes: ItemAttributes): string {
  return Object.entries(attributes)
    .map(([name, values]) => `${name}: ${values.join(", ")}`)
    .join("\n");
}

export function parseSpecifics(text: string): ItemAttributes {
  const attributes: ItemAttributes = {};
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim();
    const values = line
      .slice(colon + 1)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (name && values.length) attributes[name] = [...new Set([...(attributes[name] ?? []), ...values])];
  }
  return attributes;
}

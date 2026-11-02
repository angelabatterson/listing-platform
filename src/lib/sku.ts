// SKUs Relistic makes up when the seller hasn't given one: batch SKUs ("B12-3", or
// "B12-3-K9QZ" when taken) and imported listings ("EBAY-1234567890", "ETSY-987-2").
// Written so Postgres (`~`) and JavaScript read it the same way.
export const AUTO_SKU_PATTERN = "^(B[0-9]+-[0-9]+(-[A-Z0-9]{4})?|(EBAY|ETSY)-[0-9]+(-[0-9]+)?)$";

const autoSku = new RegExp(AUTO_SKU_PATTERN);

// True when the item still has a made-up SKU rather than the seller's own.
export function isAutoSku(sku: string): boolean {
  return autoSku.test(sku);
}

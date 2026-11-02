// The money boxes on the Sales page, in table order. Kept apart from the server code so
// the page's boxes and the spreadsheet use the same names.
export const MONEY_FIELDS = {
  price: { label: "Price", column: "priceCents", heading: "Price" },
  shipping: { label: "Shipping charged", column: "shippingCents", heading: "Shipping charged" },
  tax: { label: "Sales tax", column: "taxCents", heading: "Sales tax" },
  refund: { label: "Refund", column: "refundCents", heading: "Refund" },
  fees: { label: "Store fees", column: "feesCents", heading: "Store fees" },
  shippingCost: { label: "Shipping cost", column: "shippingCostCents", heading: "Shipping cost" },
  cost: { label: "Cost of goods", column: "costCents", heading: "Cost of goods" },
  other: { label: "Other costs", column: "otherCostCents", heading: "Other costs" },
} as const;

export type MoneyField = keyof typeof MONEY_FIELDS;
export const MONEY_FIELD_KEYS = Object.keys(MONEY_FIELDS) as MoneyField[];
export const isMoneyField = (v: unknown): v is MoneyField => typeof v === "string" && v in MONEY_FIELDS;

// "$1,234.50" or "12" as cents; "" as null; undefined when it isn't an amount.
export function parseDollars(text: string): number | null | undefined {
  const clean = text.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (clean === "") return null;
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(clean)) return undefined;
  return Math.round(Number(clean) * 100);
}

export const dollars = (cents: number) => (cents / 100).toFixed(2);

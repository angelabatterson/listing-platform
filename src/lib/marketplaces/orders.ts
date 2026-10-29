// A single sold line from a marketplace order, in one shape for every marketplace.
// Money is in cents and covers the whole line (every unit sold), so it adds up directly.
export type SaleLine = {
  orderId: string;
  lineId: string;
  sku: string | null;
  remoteListingId: string | null;
  quantity: number;
  soldAt: Date;
  title?: string | null;
  currency?: string | null;
  priceCents?: number | null;
  shippingCents?: number | null;
  feesCents?: number | null;
  // True when the store doesn't report its fees and they were worked out from its rates.
  feesEstimated?: boolean;
  buyerId?: string | null;
  buyerName?: string | null;
};

export const toCents = (value: string | number | undefined | null): number | null =>
  value === undefined || value === null || value === "" || Number.isNaN(Number(value))
    ? null
    : Math.round(Number(value) * 100);

// Split an order-level amount across its lines by each line's share of the order,
// so the parts always add back up to the whole.
export function apportion(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? totalCents : 0));
  const parts = weights.map((w) => Math.floor((totalCents * w) / sum));
  parts[0] += totalCents - parts.reduce((a, b) => a + b, 0);
  return parts;
}

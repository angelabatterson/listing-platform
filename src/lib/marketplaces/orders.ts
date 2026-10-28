// A single sold line from a marketplace order, in one shape for every marketplace.
export type SaleLine = {
  orderId: string;
  lineId: string;
  sku: string | null;
  remoteListingId: string | null;
  quantity: number;
  soldAt: Date;
};

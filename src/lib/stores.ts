import type { ChannelListing, Connection } from "@/db/schema";
import type { StoreOption } from "@/components/item-form";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";

export function isConnectionReady(c: Connection): boolean {
  if (c.status !== "active") return false;
  if (c.marketplace === "ebay") {
    const s = c.settings;
    return Boolean(s.merchantLocationKey && s.fulfillmentPolicyId && s.paymentPolicyId && s.returnPolicyId);
  }
  const s = c.settings;
  return Boolean(s.shopId && s.shippingProfileId && s.returnPolicyId && s.readinessStateId);
}

export function storeLabel(c: Connection): string {
  const name = MARKETPLACE_LABELS[c.marketplace];
  return c.displayName ? `${name} (${c.displayName})` : name;
}

export function storeOptions(conns: Connection[], listings: ChannelListing[] = []): StoreOption[] {
  return conns.map((c) => {
    const l = listings.find((x) => x.connectionId === c.id);
    return {
      connectionId: c.id,
      label: storeLabel(c),
      marketplace: c.marketplace,
      ready: isConnectionReady(c),
      enabled: l?.enabled ?? false,
      categoryId: l?.overrides.categoryId ?? "",
      whenMade: l?.overrides.whenMade ?? "",
      price: l?.overrides.priceCents ? (l.overrides.priceCents / 100).toFixed(2) : "",
    };
  });
}

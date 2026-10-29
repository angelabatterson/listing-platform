import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { connections, items, sales, shippingLabels, shippingSettings } from "@/db/schema";
import { decrypt } from "@/lib/crypto";

export async function getShippingSettings(orgId: string) {
  return db.query.shippingSettings.findFirst({ where: eq(shippingSettings.organizationId, orgId) });
}

export type ReadyShipping = {
  token: string;
  testMode: boolean;
  fromAddress: NonNullable<typeof shippingSettings.$inferSelect.fromAddress>;
  defaultParcel: typeof shippingSettings.$inferSelect.defaultParcel;
};

// The settings when labels can be bought, or what's still missing.
export async function readyShipping(orgId: string): Promise<{ ready?: ReadyShipping; missing?: string }> {
  const s = await getShippingSettings(orgId);
  if (!s?.apiTokenEnc) return { missing: "Add your Shippo key in Shipping settings first." };
  if (!s.fromAddress) return { missing: "Add the address you ship from in Shipping settings first." };
  return { ready: { token: decrypt(s.apiTokenEnc), testMode: s.testMode, fromAddress: s.fromAddress, defaultParcel: s.defaultParcel } };
}

export const SHIP_WINDOW_DAYS = 30;

// Orders sold recently that haven't had a label bought in Relistic, newest first.
export async function ordersToShip(orgId: string, now = new Date()) {
  const labelled = db
    .select({ x: sql`1` })
    .from(shippingLabels)
    .where(
      and(
        eq(shippingLabels.organizationId, orgId),
        eq(shippingLabels.connectionId, sales.connectionId),
        eq(shippingLabels.externalOrderId, sales.externalOrderId),
      ),
    );
  return db
    .select({
      connectionId: sales.connectionId,
      marketplace: connections.marketplace,
      orderId: sales.externalOrderId,
      soldAt: sql<Date>`max(${sales.soldAt})`.mapWith(sales.soldAt),
      buyerName: sql<string | null>`max(${sales.buyerName})`,
      titles: sql<string[]>`array_agg(coalesce(${items.title}, ${sales.title}, ${sales.sku}, 'Item') order by ${sales.externalLineId})`,
      units: sql<number>`sum(${sales.quantity})::int`,
    })
    .from(sales)
    .innerJoin(connections, eq(connections.id, sales.connectionId))
    .leftJoin(items, eq(items.id, sales.itemId))
    .where(
      and(
        eq(sales.organizationId, orgId),
        gte(sales.soldAt, new Date(now.getTime() - SHIP_WINDOW_DAYS * 86_400_000)),
        sql`not exists (${labelled})`,
      ),
    )
    .groupBy(sales.connectionId, connections.marketplace, sales.externalOrderId)
    .orderBy(sql`max(${sales.soldAt}) desc`);
}

export async function recentLabels(orgId: string, limit = 20) {
  return db
    .select({ label: shippingLabels, marketplace: connections.marketplace })
    .from(shippingLabels)
    .innerJoin(connections, eq(connections.id, shippingLabels.connectionId))
    .where(eq(shippingLabels.organizationId, orgId))
    .orderBy(desc(shippingLabels.createdAt))
    .limit(limit);
}

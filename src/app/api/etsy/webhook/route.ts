import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { fetchEtsyReceipt, receiptToSales } from "@/lib/marketplaces/etsy/orders";
import { verifyEtsyWebhook } from "@/lib/marketplaces/etsy/webhook";
import { recordSales } from "@/lib/sync/sales";

// Etsy calls this when an order is paid, so a sale comes down from the other stores
// within seconds instead of at the next scheduled check.
export async function POST(request: NextRequest) {
  const secret = process.env.ETSY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const rawBody = await request.text();
  const valid = verifyEtsyWebhook(
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    rawBody,
    secret,
  );
  if (!valid) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  const event = JSON.parse(rawBody) as { event_type?: string; resource_url?: string; shop_id?: string | number };
  if (event.event_type !== "order.paid") return new NextResponse(null, { status: 200 });

  const shopId = String(event.shop_id);
  const receiptId = event.resource_url?.match(/\/receipts\/(\d+)/)?.[1];
  const connection = await db.query.connections.findFirst({
    where: and(eq(connections.marketplace, "etsy"), eq(connections.externalAccountId, shopId), eq(connections.status, "active")),
  });
  if (!connection || !receiptId) return new NextResponse(null, { status: 200 });

  const receipt = await fetchEtsyReceipt(connection, receiptId);
  await recordSales(connection, receiptToSales(receipt));
  return new NextResponse(null, { status: 200 });
}

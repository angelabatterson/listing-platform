import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { extensionCaller } from "@/lib/extension/keys";
import { EXTENSION_MARKETPLACES, MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";

// Who the extension is connected as, and which of its stores the account has added.
export async function GET(request: Request) {
  const caller = await extensionCaller(request);
  if (!caller) return Response.json({ error: "Connect the extension to Relistic again." }, { status: 401 });
  const stores = await db.query.connections.findMany({
    where: and(
      eq(connections.organizationId, caller.organizationId),
      eq(connections.status, "active"),
      inArray(connections.marketplace, [...EXTENSION_MARKETPLACES]),
    ),
  });
  return Response.json({
    email: caller.email,
    stores: stores.map((s) => ({ marketplace: s.marketplace, name: MARKETPLACE_LABELS[s.marketplace] })),
  });
}

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { batches, items } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { EBAY_CONDITIONS, formatPrice } from "@/lib/marketplaces/ebay/mapping";

// Every item drafted from a batch, as a spreadsheet: for records, or for uploading
// to a marketplace this app doesn't connect to.
export async function GET(_request: Request, ctx: RouteContext<"/api/batches/[id]/export">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please log in again.", { status: 401 });
  const { id } = await ctx.params;
  const batch = await db.query.batches.findFirst({
    where: and(eq(batches.id, id), eq(batches.organizationId, user.organizationId)),
  });
  if (!batch) return new Response("Not found", { status: 404 });

  const rows = await db.query.items.findMany({
    where: and(eq(items.batchId, batch.id), eq(items.organizationId, user.organizationId)),
    orderBy: asc(items.createdAt),
    with: { images: true, listings: { with: { connection: true } } },
  });
  const conditionLabel = new Map<string, string>(EBAY_CONDITIONS.map((c) => [c.value, c.label]));
  const category = (item: (typeof rows)[number], marketplace: "ebay" | "etsy") =>
    item.listings.find((l) => l.connection.marketplace === marketplace)?.overrides.categoryId ?? "";

  const csv = toCsv([
    ["SKU", "Title", "Price (USD)", "Quantity", "Condition", "Brand", "Description", "Item specifics", "eBay category ID", "Etsy category ID", "Photo links", "Status"],
    ...rows.map((item) => [
      item.sku,
      item.title,
      formatPrice(item.priceCents),
      item.quantity,
      conditionLabel.get(item.condition) ?? item.condition,
      item.brand,
      item.description,
      Object.entries(item.attributes).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; "),
      category(item, "ebay"),
      category(item, "etsy"),
      [...item.images].sort((a, b) => a.position - b.position).map((i) => i.url).join(" "),
      item.status,
    ]),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="batch-B${batch.number}.csv"`,
    },
  });
}

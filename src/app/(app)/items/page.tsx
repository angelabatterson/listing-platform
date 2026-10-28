import { and, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { items } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";

const statusStyles: Record<string, string> = {
  listed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  ended: "bg-zinc-100 text-zinc-600",
  not_listed: "bg-zinc-100 text-zinc-600",
};

const statusText: Record<string, string> = {
  listed: "Listed",
  error: "Needs attention",
  ended: "Ended",
  not_listed: "Not listed",
};

export default async function ItemsPage() {
  const user = await requireUser();
  const rows = await db.query.items.findMany({
    where: and(eq(items.organizationId, user.organizationId), ne(items.status, "archived")),
    orderBy: desc(items.updatedAt),
    with: { listings: { with: { connection: true } } },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <Link href="/items/new" className="btn">Add item</Link>
      </div>
      {rows.length === 0 ? (
        <div className="card text-zinc-600">No items yet. Add your first item to start listing.</div>
      ) : (
        <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Stores</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="border-t border-zinc-100">
                <td className="px-4 py-2">
                  <Link href={`/items/${item.id}`} className="font-medium hover:underline">{item.title}</Link>
                  {item.status === "draft" && <span className="ml-2 text-xs text-zinc-500">Draft</span>}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{item.sku}</td>
                <td className="px-4 py-2">${formatPrice(item.priceCents)}</td>
                <td className="px-4 py-2">{item.quantity}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {item.listings
                      .filter((l) => l.enabled || l.status !== "not_listed")
                      .map((l) => (
                        <span key={l.id} className={`rounded px-2 py-0.5 text-xs ${statusStyles[l.status]}`}>
                          {MARKETPLACE_LABELS[l.connection.marketplace]}: {statusText[l.status]}
                        </span>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

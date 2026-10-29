import { eq } from "drizzle-orm";
import Link from "next/link";
import { money, shortDate } from "@/components/money";
import { db } from "@/db";
import { buyerNotes } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { buyerPurchases, buyers } from "@/lib/dashboard";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { saveBuyerNote } from "./actions";

export default async function CrmPage() {
  const user = await requireUser();
  const org = user.organizationId;
  const [list, purchases, notes] = await Promise.all([
    buyers(org, 500),
    buyerPurchases(org),
    db.query.buyerNotes.findMany({ where: eq(buyerNotes.organizationId, org) }),
  ]);
  const key = (marketplace: string, buyerId: string | null) => `${marketplace}:${buyerId}`;
  const noteFor = new Map(notes.map((n) => [key(n.marketplace, n.buyerId), n.note]));
  const boughtBy = Map.groupBy(purchases, (p) => key(p.marketplace, p.buyerId));
  const repeat = list.filter((b) => b.orders > 1).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">CRM</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Everyone who has bought from your stores, biggest spenders first
          {list.length > 0 && `. ${repeat} of ${list.length} have come back for more`}. Notes are only seen by you.
        </p>
      </div>

      {list.length === 0 ? (
        <div className="card text-zinc-600">Buyers show up here after your first sale on a connected store.</div>
      ) : (
        <ul className="space-y-3">
          {list.map((b) => {
            const k = key(b.marketplace, b.buyerId);
            const bought = boughtBy.get(k) ?? [];
            return (
              <li key={k} className="card space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-medium">{b.name ?? b.buyerId}</span>
                    <span className="text-sm text-zinc-500">
                      {" "}
                      · {MARKETPLACE_LABELS[b.marketplace]}
                      {b.name && b.name !== b.buyerId && b.marketplace === "ebay" && ` · ${b.buyerId}`}
                    </span>
                    {b.orders > 1 && (
                      <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Repeat buyer</span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-600 tabular-nums">
                    {b.orders} {b.orders === 1 ? "order" : "orders"} · {money(b.spent)} · last {shortDate(b.lastBought)}
                  </div>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-zinc-600">
                    {b.units} {b.units === 1 ? "item" : "items"} bought
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {bought.map((p) => (
                      <li key={p.id} className="flex justify-between gap-4">
                        <span className="min-w-0 truncate">
                          {p.itemId ? (
                            <Link href={`/items/${p.itemId}`} className="hover:underline">{p.title ?? "Item"}</Link>
                          ) : (
                            (p.title ?? "Item")
                          )}
                          {p.quantity > 1 && <span className="text-zinc-500"> × {p.quantity}</span>}
                        </span>
                        <span className="shrink-0 text-zinc-500 tabular-nums">
                          {shortDate(p.soldAt)}
                          {p.priceCents !== null && ` · ${money(p.priceCents)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
                <form action={saveBuyerNote} className="flex gap-2">
                  <input type="hidden" name="marketplace" value={b.marketplace} />
                  <input type="hidden" name="buyerId" value={b.buyerId ?? ""} />
                  <input
                    name="note"
                    className="input flex-1"
                    placeholder="Add a note, e.g. collects vintage Pyrex"
                    defaultValue={noteFor.get(k) ?? ""}
                    maxLength={2000}
                    aria-label={`Note about ${b.name ?? b.buyerId}`}
                  />
                  <button className="btn-secondary">Save note</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

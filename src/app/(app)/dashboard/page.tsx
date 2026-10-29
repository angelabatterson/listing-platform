import Link from "next/link";
import { money, shortDate } from "@/components/money";
import { requireUser } from "@/lib/auth";
import {
  buyers,
  inventorySummary,
  isRangeKey,
  RANGES,
  rangeBounds,
  recentSales,
  salesByMonth,
  salesByStore,
  salesTotals,
  STALE_DAYS,
  staleItems,
  type RangeKey,
  type Totals,
} from "@/lib/dashboard";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";

function Tile(props: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  const tone = props.tone === "bad" ? "text-red-700" : props.tone === "good" ? "text-green-800" : "";
  return (
    <div className="card">
      <div className="text-sm text-zinc-600">{props.label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{props.value}</div>
      {props.note && <div className="mt-1 text-xs text-zinc-500">{props.note}</div>}
    </div>
  );
}

function TotalsCells({ t }: { t: Totals }) {
  return (
    <>
      <td className="px-4 py-2 text-right tabular-nums">{t.units}</td>
      <td className="px-4 py-2 text-right tabular-nums">{money(t.sales)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{money(t.fees)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${t.profit < 0 ? "text-red-700" : ""}`}>{money(t.profit)}</td>
    </>
  );
}

const th = "px-4 py-2 font-medium";
const thRight = `${th} text-right`;

function TotalsHead({ first }: { first: string }) {
  return (
    <thead className="bg-zinc-50 text-left text-zinc-600">
      <tr>
        <th className={th}>{first}</th>
        <th className={thRight}>Sold</th>
        <th className={thRight}>Sales</th>
        <th className={thRight}>Fees</th>
        <th className={thRight}>Profit</th>
      </tr>
    </thead>
  );
}

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const { range: rangeParam } = await props.searchParams;
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "30d";
  const user = await requireUser();
  const org = user.organizationId;
  const { from, to } = rangeBounds(range);

  const [t, stores, months, stock, stale, recent, topBuyers] = await Promise.all([
    salesTotals(org, from, to),
    salesByStore(org, from, to),
    salesByMonth(org),
    inventorySummary(org),
    staleItems(org),
    recentSales(org),
    buyers(org, 5),
  ]);
  const everSold = recent.length > 0;

  const notes = [
    t.uncosted > 0 &&
      `${t.uncosted === 1 ? "1 sale has" : `${t.uncosted} sales have`} no "What you paid" amount, so profit counts ${t.uncosted === 1 ? "it" : "them"} as free. Add it on the item to make profit exact.`,
    t.estimatedFees > 0 && "Etsy doesn't share its fees with apps, so Etsy fees are estimated from its standard US rates.",
    t.unpriced > 0 && `${t.unpriced} older ${t.unpriced === 1 ? "sale was" : "sales were"} recorded before prices were tracked and count as $0.`,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <nav className="flex flex-wrap gap-1 text-sm">
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <Link
              key={key}
              href={key === "30d" ? "/dashboard" : `/dashboard?range=${key}`}
              className={`rounded-md px-3 py-1.5 ${key === range ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {RANGES[key]}
            </Link>
          ))}
        </nav>
      </div>

      {!everSold && (
        <div className="card text-zinc-600">
          Nothing has sold yet. Once a store is connected and an item sells, your sales, fees and profit show up here
          automatically.
        </div>
      )}

      <section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label="Sales" value={money(t.sales)} note={t.shipping ? `Plus ${money(t.shipping)} shipping charged` : undefined} />
          <Tile label="Items sold" value={String(t.units)} note={t.units ? `Average ${money(Math.round(t.sales / t.units))}` : undefined} />
          <Tile label="Store fees" value={money(t.fees)} />
          <Tile label="What you paid" value={money(t.cost)} />
          <Tile label="Profit" value={money(t.profit)} tone={t.profit < 0 ? "bad" : t.profit > 0 ? "good" : undefined} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Profit is sales minus store fees and what you paid for the items. Shipping isn&apos;t included yet.
        </p>
        {notes.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-500">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">In stock now</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Tile label="Active items" value={String(stock.items)} note={`${stock.units} in stock`} />
          <Tile label="Worth at your prices" value={money(stock.value)} />
          <Tile label="What you paid for it" value={money(stock.cost)} />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">By store ({RANGES[range].toLowerCase()})</h2>
          {stores.length === 0 ? (
            <p className="text-sm text-zinc-600">No sales in this period.</p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
              <TotalsHead first="Store" />
              <tbody>
                {stores.map((s) => (
                  <tr key={s.marketplace} className="border-t border-zinc-100">
                    <td className="px-4 py-2">{MARKETPLACE_LABELS[s.marketplace]}</td>
                    <TotalsCells t={s} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Last 12 months</h2>
          <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
            <TotalsHead first="Month" />
            <tbody>
              {months.map(({ month, totals }) => (
                <tr key={month.toISOString()} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap px-4 py-2">
                    {month.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}
                  </td>
                  {totals ? (
                    <TotalsCells t={totals} />
                  ) : (
                    <td colSpan={4} className="px-4 py-2 text-right text-zinc-400">No sales</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent sales</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-600">No sales yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-600">
                <tr>
                  <th className={th}>Sold</th>
                  <th className={th}>Item</th>
                  <th className={th}>Store</th>
                  <th className={th}>Buyer</th>
                  <th className={thRight}>Price</th>
                  <th className={thRight}>Profit</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => {
                  const profit =
                    s.priceCents === null ? null : s.priceCents - (s.feesCents ?? 0) - (s.costCents ?? 0) * s.quantity;
                  return (
                    <tr key={s.id} className="border-t border-zinc-100">
                      <td className="whitespace-nowrap px-4 py-2 text-zinc-500">{shortDate(s.soldAt)}</td>
                      <td className="px-4 py-2">
                        {s.itemId ? (
                          <Link href={`/items/${s.itemId}`} className="hover:underline">{s.title ?? "Item"}</Link>
                        ) : (
                          (s.title ?? "Not an item in Relistic")
                        )}
                        {s.quantity > 1 && <span className="text-zinc-500"> × {s.quantity}</span>}
                      </td>
                      <td className="px-4 py-2">{MARKETPLACE_LABELS[s.marketplace]}</td>
                      <td className="px-4 py-2">{s.buyerName ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.priceCents === null ? "—" : money(s.priceCents)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${profit !== null && profit < 0 ? "text-red-700" : ""}`}>
                        {profit === null ? "—" : money(profit)}
                        {s.costCents === null && profit !== null && <span className="text-zinc-400" title="No cost entered">*</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {recent.some((s) => s.costCents === null) && (
              <p className="mt-2 text-xs text-zinc-500">* No &quot;What you paid&quot; entered for this item yet.</p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-lg font-semibold">Sitting unsold</h2>
          <p className="mb-3 text-sm text-zinc-600">
            Active items in stock for more than {STALE_DAYS} days. Consider a price drop or a fresh photo.
          </p>
          {stale.length === 0 ? (
            <p className="text-sm text-zinc-600">Nothing has been waiting that long.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
              {stale.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-2">
                  <Link href={`/items/${item.id}`} className="min-w-0 truncate hover:underline">{item.title}</Link>
                  <span className="shrink-0 text-zinc-500 tabular-nums">
                    {money(item.priceCents)} · {item.days} days
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Top buyers</h2>
            <Link href="/crm" className="text-sm underline">All buyers in CRM</Link>
          </div>
          {topBuyers.length === 0 ? (
            <p className="text-sm text-zinc-600">Buyers show up here after your first sale.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
              {topBuyers.map((b) => (
                <li key={`${b.marketplace}:${b.buyerId}`} className="flex items-center justify-between gap-4 px-4 py-2">
                  <span className="min-w-0 truncate">
                    {b.name ?? b.buyerId}
                    <span className="text-zinc-500"> · {MARKETPLACE_LABELS[b.marketplace]}</span>
                    {b.orders > 1 && (
                      <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Repeat</span>
                    )}
                  </span>
                  <span className="shrink-0 text-zinc-500 tabular-nums">{money(b.spent)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

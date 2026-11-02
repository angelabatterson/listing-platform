import { and, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { money, shortDate } from "@/components/money";
import { AddSaleForm, DeleteSaleButton, ImportSalesForm, MoneyBox } from "@/components/sales-row";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { byStoreOrder, MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { dollars, MONEY_FIELD_KEYS, MONEY_FIELDS } from "@/lib/sale-fields";
import { listSales, moneyValue, parseSalesFilters, SALES_PAGE_SIZE, salesHref, type SaleWithMoney } from "@/lib/sales-table";
import { readyShipping } from "@/lib/shipping/settings";
import { storeLabel } from "@/lib/stores";

const thumbOf = (url: string) => (url.includes("/api/photos/") && !url.endsWith("-thumb.jpg") ? url.replace(/\.jpg$/, "-thumb.jpg") : url);

// Stores whose orders Relistic can buy a Shippo label for (it needs the buyer's address).
const SHIPPO_STORES = new Set(["ebay", "etsy"]);

function LabelLinks(props: { row: SaleWithMoney; shippo: boolean }) {
  const { sale, store, label, orderLink } = props.row;
  const name = MARKETPLACE_LABELS[store.marketplace];
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {label && (
        <a href={label.labelUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-green-800 hover:underline">
          Print your Shippo label
        </a>
      )}
      {orderLink && (
        <a href={orderLink} target="_blank" rel="noreferrer" className="whitespace-nowrap text-zinc-700 hover:underline">
          {sale.manual ? `Open ${name} orders` : `Print label on ${name}`} ↗
        </a>
      )}
      {!label && !sale.manual && props.shippo && SHIPPO_STORES.has(store.marketplace) && (
        <Link
          href={`/shipping/${sale.connectionId}/${encodeURIComponent(sale.externalOrderId)}`}
          className="whitespace-nowrap text-zinc-700 hover:underline"
        >
          Buy label with Shippo
        </Link>
      )}
    </div>
  );
}

export default async function SalesPage(props: PageProps<"/sales">) {
  const user = await requireUser("sales");
  const org = user.organizationId;
  const params = await props.searchParams;
  const f = parseSalesFilters(params);
  const [{ rows, total }, connected, shipping] = await Promise.all([
    listSales(org, f),
    db.query.connections.findMany({ where: and(eq(connections.organizationId, org), ne(connections.status, "disconnected")) }),
    readyShipping(org),
  ]);
  const stores = byStoreOrder(connected);
  const pages = Math.max(1, Math.ceil(total / SALES_PAGE_SIZE));
  const filtered = Boolean(f.q || f.store);
  const exportQuery = new URLSearchParams({ ...(f.q ? { q: f.q } : {}), ...(f.store ? { store: f.store } : {}) }).toString();
  const sum = (pick: (r: SaleWithMoney) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const anyEstimated = rows.some((r) => r.money.feesEstimated);
  const anyUncosted = rows.some((r) => !r.money.costKnown);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sales</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Everything you&apos;ve sold, newest first. Click any amount to change it; profit updates by itself.
          </p>
        </div>
        <a href={`/api/sales/export${exportQuery ? `?${exportQuery}` : ""}`} className="btn-secondary">
          Download spreadsheet
        </a>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <details className="card">
          <summary className="cursor-pointer font-medium">Add a sale by hand</summary>
          <div className="mt-3">
            <AddSaleForm stores={stores.map((c) => ({ id: c.id, label: storeLabel(c) }))} today={new Date().toISOString().slice(0, 10)} />
          </div>
        </details>
        <details className="card">
          <summary className="cursor-pointer font-medium">Upload a sales spreadsheet</summary>
          <div className="mt-3">
            <ImportSalesForm />
          </div>
        </details>
      </div>

      <FilterForm action="/sales" className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="search"
          name="q"
          defaultValue={f.q}
          placeholder="Search title or SKU"
          className="input min-w-0 flex-1 basis-56"
          aria-label="Search title or SKU"
        />
        <select name="store" defaultValue={f.store} className="input w-auto" aria-label="Store">
          <option value="">Any store</option>
          {stores.map((c) => (
            <option key={c.id} value={c.id}>{storeLabel(c)}</option>
          ))}
        </select>
        <button className="btn-secondary">Search</button>
        {filtered && (
          <Link href="/sales" className="text-zinc-600 underline">
            Clear filters
          </Link>
        )}
      </FilterForm>

      {rows.length === 0 ? (
        <div className="card text-zinc-600">
          {filtered
            ? "No sales match. Try clearing the filters."
            : "No sales yet. Sales from your connected stores show up here by themselves, and you can add others by hand."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-2 font-medium">Sold item</th>
                {MONEY_FIELD_KEYS.map((k) => (
                  <th key={k} className="px-2 py-2 text-right font-medium">{MONEY_FIELDS[k].label}</th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { sale, store, item, photo, money: m } = row;
                const title = item?.title ?? sale.title ?? sale.sku ?? "Item";
                return (
                  <tr key={sale.id} className="border-t border-zinc-100 align-top">
                    <td className="px-4 py-2">
                      <div className="flex min-w-64 gap-3">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts
                          <img src={thumbOf(photo)} alt="" className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded bg-zinc-100" />
                        )}
                        <div className="min-w-0">
                          {item ? (
                            <Link href={`/items/${item.id}`} className="font-medium hover:underline">{title}</Link>
                          ) : (
                            <span className="font-medium">{title}</span>
                          )}
                          <div className="text-xs text-zinc-500">
                            {shortDate(sale.soldAt)} · {storeLabel(store)}
                            {(item?.sku ?? sale.sku) && <> · <span className="font-mono">{item?.sku ?? sale.sku}</span></>}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {sale.quantity} sold{item ? ` · ${item.quantity} left` : ""}
                            {sale.buyerName && ` · ${sale.buyerName}`}
                            {sale.manual && (
                              <>
                                {" · Added by you · "}
                                <DeleteSaleButton saleId={sale.id} />
                              </>
                            )}
                          </div>
                          <LabelLinks row={row} shippo={Boolean(shipping.ready)} />
                        </div>
                      </div>
                    </td>
                    {MONEY_FIELD_KEYS.map((k) => {
                      const cents = moneyValue(sale, m, k);
                      const value = cents === null ? "" : dollars(cents);
                      return (
                        <td key={k} className="px-1 py-2">
                          <MoneyBox
                            key={`${k}:${value}`}
                            saleId={sale.id}
                            field={k}
                            value={value}
                            label={`${MONEY_FIELDS[k].label} for ${title}`}
                            estimated={k === "fees" && m.feesEstimated}
                          />
                        </td>
                      );
                    })}
                    <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${m.profit < 0 ? "text-red-700" : ""}`}>
                      {money(m.profit)}
                      {!m.costKnown && <span className="text-zinc-400" title="No cost of goods entered">*</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-zinc-200 bg-zinc-50 font-medium">
              <tr>
                <td className="px-4 py-2">{pages > 1 ? "This page" : "Total"}</td>
                {MONEY_FIELD_KEYS.map((k) => (
                  <td key={k} className="px-2 py-2 text-right tabular-nums">{money(sum((r) => moneyValue(r.sale, r.money, k) ?? 0))}</td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{money(sum((r) => r.money.profit))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-500">
          {anyUncosted && <li>* No cost of goods yet, so profit counts the item as free. Type it in the Cost of goods box, or on the item.</li>}
          {anyEstimated && <li>Fees in grey italics are estimated from the store&apos;s standard rates. Type the real amount to replace them.</li>}
          <li>Profit is price plus shipping charged, minus refund, fees, shipping cost, cost of goods and other costs. Sales tax is shown but not counted, since it goes to the state.</li>
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-600">
          <span>
            Page {f.page} of {pages} · {total} sales
          </span>
          <div className="flex gap-2">
            {f.page > 1 && <Link href={salesHref(f, { page: f.page - 1 })} className="btn-secondary">Previous</Link>}
            {f.page < pages && <Link href={salesHref(f, { page: f.page + 1 })} className="btn-secondary">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

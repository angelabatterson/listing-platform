import { and, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  allTags,
  filterHref,
  ISSUES,
  listInventory,
  PAGE_SIZE,
  parseFilters,
  SORTS,
  viewCounts,
  VIEWS,
  type View,
} from "@/lib/inventory";
import { storeLabel } from "@/lib/stores";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";

const statusStyles: Record<string, string> = {
  listed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  ended: "bg-zinc-100 text-zinc-600",
  not_listed: "bg-zinc-100 text-zinc-600",
  waiting: "bg-amber-100 text-amber-900",
};

const statusText: Record<string, string> = {
  listed: "Listed",
  error: "Needs attention",
  ended: "Ended",
  not_listed: "Not listed",
  waiting: "Waiting in extension",
};

// Relistic's own photo links have a small copy for lists like this one.
const thumbOf = (url: string) => (url.includes("/api/photos/") && !url.endsWith("-thumb.jpg") ? url.replace(/\.jpg$/, "-thumb.jpg") : url);

export default async function ItemsPage(props: PageProps<"/items">) {
  const user = await requireUser();
  const org = user.organizationId;
  const f = parseFilters(await props.searchParams);
  const [{ rows, total }, counts, tags, stores] = await Promise.all([
    listInventory(org, f),
    viewCounts(org, f),
    allTags(org),
    db.query.connections.findMany({
      where: and(eq(connections.organizationId, org), ne(connections.status, "disconnected")),
    }),
  ]);
  const filtered = Boolean(f.q || f.store || f.issue || f.tag);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <Link href="/items/new" className="btn">Add item</Link>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 text-sm">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={filterHref(f, { view: v })}
            aria-current={f.view === v ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 ${
              f.view === v ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {VIEWS[v]} <span className="text-zinc-500">{counts[v]}</span>
          </Link>
        ))}
      </nav>

      <FilterForm className="flex flex-wrap items-center gap-2 text-sm">
        {f.view !== "all" && <input type="hidden" name="view" value={f.view} />}
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
        <select name="issue" defaultValue={f.issue} className="input w-auto" aria-label="Problems">
          <option value="">Any status</option>
          {Object.entries(ISSUES).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        {tags.length > 0 && (
          <select name="tag" defaultValue={f.tag} className="input w-auto" aria-label="Tag">
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <select name="sort" defaultValue={f.sort} className="input w-auto" aria-label="Sort">
          {Object.entries(SORTS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <button className="btn-secondary">Search</button>
        {filtered && (
          <Link href={filterHref(f, { q: "", store: "", issue: "", tag: "" })} className="text-zinc-600 underline">
            Clear filters
          </Link>
        )}
      </FilterForm>

      {rows.length === 0 ? (
        <div className="card text-zinc-600">
          {filtered || f.view !== "all"
            ? "No items match. Try another tab or clear the filters."
            : "No items yet. Add your first item to start listing."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
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
              {rows.map((item) => {
                const photo = [...item.images].sort((a, b) => a.position - b.position)[0];
                return (
                  <tr key={item.id} className="border-t border-zinc-100 align-top">
                    <td className="px-4 py-2">
                      <div className="flex min-w-56 gap-3">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts
                          <img src={thumbOf(photo.url)} alt="" className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded bg-zinc-100" />
                        )}
                        <div>
                          <Link href={`/items/${item.id}`} className="font-medium hover:underline">{item.title}</Link>
                          {item.status === "draft" && <span className="ml-2 text-xs text-zinc-500">Draft</span>}
                          {item.status === "sold_out" && <span className="ml-2 text-xs text-zinc-500">Sold</span>}
                          {item.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.tags.map((t) => (
                                <Link
                                  key={t}
                                  href={filterHref(f, { tag: t })}
                                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-200"
                                >
                                  {t}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{item.sku}</td>
                    <td className="px-4 py-2">${formatPrice(item.priceCents)}</td>
                    <td className="px-4 py-2">{item.quantity}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {item.listings
                          .filter((l) => l.enabled || l.status !== "not_listed")
                          .map((l) => (
                            <span key={l.id} className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${statusStyles[l.status]}`}>
                              {MARKETPLACE_LABELS[l.connection.marketplace]}: {statusText[l.status]}
                            </span>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-600">
          <span>
            Page {f.page} of {pages} · {total} items
          </span>
          <div className="flex gap-2">
            {f.page > 1 && <Link href={filterHref(f, { page: f.page - 1 })} className="btn-secondary">Previous</Link>}
            {f.page < pages && <Link href={filterHref(f, { page: f.page + 1 })} className="btn-secondary">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

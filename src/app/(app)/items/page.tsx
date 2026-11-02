import { and, count, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { BulkCrosslist, RowCheck, SelectAll } from "@/components/bulk-crosslist";
import { FilterForm } from "@/components/filter-form";
import { DuplicateNote, FailedBanner, FavoriteStar, RowField, ScheduledBadge } from "@/components/inventory-row";
import { db } from "@/db";
import { channelListings, connections, items, type ChannelListing, type Connection } from "@/db/schema";
import { StoreCell, type StoreCellListing } from "@/components/store-cell";
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
import { byStoreOrder } from "@/lib/marketplaces/labels";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";
import { isAutoSku } from "@/lib/sku";
import { duplicatesFor } from "@/lib/duplicates";
import { applyPriceRule } from "@/lib/price-rules";

// Where a listing can be seen, when Relistic knows.
function listingLink(listing: ChannelListing, store: Connection): string | null {
  if (listing.remoteUrl) return listing.remoteUrl;
  const id = listing.remoteListingId;
  if (!id || listing.status === "ended") return null;
  if (store.marketplace === "ebay") return `https://www.${store.environment === "sandbox" ? "sandbox." : ""}ebay.com/itm/${id}`;
  if (store.marketplace === "etsy") return `https://www.etsy.com/listing/${id}`;
  if (store.marketplace === "shopify" && store.settings.shopDomain) {
    return `https://${store.settings.shopDomain}/admin/products/${id.split("/").pop()}`;
  }
  return null;
}

function cellListing(item: { priceCents: number }, listing: ChannelListing | undefined, store: Connection): StoreCellListing | null {
  if (!listing || (!listing.enabled && (listing.status === "not_listed" || listing.status === "ended"))) return null;
  return {
    status: listing.status,
    priceCents: listing.overrides.priceCents ?? applyPriceRule(item.priceCents, store.settings.priceRule),
    link: listingLink(listing, store),
    error: listing.lastError,
  };
}

// Relistic's own photo links have a small copy for lists like this one.
const thumbOf = (url: string) => (url.includes("/api/photos/") && !url.endsWith("-thumb.jpg") ? url.replace(/\.jpg$/, "-thumb.jpg") : url);

export default async function ItemsPage(props: PageProps<"/items">) {
  const user = await requireUser();
  const org = user.organizationId;
  const f = parseFilters(await props.searchParams);
  const [{ rows, total }, counts, tags, connected, [{ failed }]] = await Promise.all([
    listInventory(org, f),
    viewCounts(org, f),
    allTags(org),
    db.query.connections.findMany({
      where: and(eq(connections.organizationId, org), ne(connections.status, "disconnected")),
    }),
    db
      .select({ failed: count() })
      .from(channelListings)
      .innerJoin(items, eq(items.id, channelListings.itemId))
      .where(and(eq(items.organizationId, org), eq(channelListings.status, "error"))),
  ]);
  const stores = byStoreOrder(connected);
  const duplicates = f.view === "duplicates" ? await duplicatesFor(org) : null;
  const filtered = Boolean(f.q || f.store || f.issue || f.tag);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <Link href="/items/new" className="btn">Add item</Link>
      </div>

      {failed > 0 && <FailedBanner count={failed} href={filterHref(f, { view: "all", issue: "error" })} />}

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

      {f.view === "duplicates" && (
        <p className="text-sm text-zinc-600">
          Items that may be the same thing entered twice: the same or a very similar title, the same SKU, or the same
          photo. Open one to compare, then archive the copy, or click <strong>Not a duplicate</strong> to hide it here.
        </p>
      )}

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
        <BulkCrosslist
          items={rows.map((r) => ({ id: r.id, title: r.title }))}
          stores={stores.map((c) => ({ id: c.id, label: storeLabel(c) }))}
        >
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="w-8 py-2 pl-3"><SelectAll /></th>
                <th className="w-8 px-2 py-2"><span className="sr-only">Favorite</span></th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Cost</th>
                <th className="px-4 py-2">Qty</th>
                {stores.map((c) => (
                  <th key={c.id} className="whitespace-nowrap px-4 py-2">{MARKETPLACE_LABELS[c.marketplace]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const photo = [...item.images].sort((a, b) => a.position - b.position)[0];
                return (
                  <tr key={item.id} className="border-t border-zinc-100 align-top">
                    <td className="py-2.5 pl-3">
                      <RowCheck itemId={item.id} title={item.title} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <FavoriteStar itemId={item.id} favorite={item.favorite} />
                    </td>
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
                          {duplicates?.get(item.id) && <DuplicateNote itemId={item.id} {...duplicates.get(item.id)!} />}
                          {item.status === "draft" && item.scheduledAt && (
                            <ScheduledBadge itemId={item.id} at={item.scheduledAt.toISOString()} />
                          )}
                          {item.status === "sold_out" && <span className="ml-2 text-xs text-zinc-500">Sold</span>}
                          <RowField
                            itemId={item.id}
                            field="notes"
                            value={item.notes}
                            label={`Private notes for ${item.title}`}
                            placeholder="+ Add a private note"
                            className="-ml-1 mt-0.5 w-full min-w-48 text-xs text-zinc-600"
                          />
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
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs">{item.sku}</span>
                      {isAutoSku(item.sku) && (
                        <Link
                          href={`/items/${item.id}`}
                          title="This item still has an automatic SKU. Open it to type your own."
                          className="mt-1 block w-fit whitespace-nowrap rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-200"
                        >
                          Missing SKU
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2">${formatPrice(item.priceCents)}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center">
                        $
                        <RowField
                          itemId={item.id}
                          field="cost"
                          value={item.costCents === null ? "" : formatPrice(item.costCents)}
                          label={`What you paid for ${item.title}`}
                          placeholder="0.00"
                          className="w-16"
                        />
                      </span>
                    </td>
                    <td className="px-4 py-2">{item.quantity}</td>
                    {stores.map((c) => (
                      <td key={c.id} className="px-4 py-2">
                        <StoreCell
                          itemId={item.id}
                          itemTitle={item.title}
                          connectionId={c.id}
                          storeName={MARKETPLACE_LABELS[c.marketplace]}
                          listing={cellListing(item, item.listings.find((l) => l.connectionId === c.id), c)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </BulkCrosslist>
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

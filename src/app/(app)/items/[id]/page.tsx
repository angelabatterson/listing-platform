import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ItemForm } from "@/components/item-form";
import { db } from "@/db";
import { connections, items } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";
import { formatSpecifics } from "@/lib/specifics";
import { storeLabel, storeOptions } from "@/lib/stores";
import { archiveItem, resyncItem, saveItem } from "../actions";

export default async function ItemPage(props: PageProps<"/items/[id]">) {
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const user = await requireUser();

  const item = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.organizationId, user.organizationId)),
    with: { images: true, listings: true },
  });
  if (!item) notFound();
  const conns = await db.query.connections.findMany({
    where: eq(connections.organizationId, user.organizationId),
  });
  const listingProblems = item.listings.filter((l) => l.status === "error");
  const images = [...item.images].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{item.title}</h1>
        <div className="flex gap-2">
          <form action={resyncItem.bind(null, item.id)}>
            <button className="btn-secondary">Sync now</button>
          </form>
          {item.status !== "archived" && (
            <form action={archiveItem.bind(null, item.id)}>
              <button className="btn-secondary text-red-700">Archive and end listings</button>
            </form>
          )}
        </div>
      </div>

      {saved && listingProblems.length === 0 && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">Saved and synced.</p>
      )}
      {listingProblems.map((l) => {
        const conn = conns.find((c) => c.id === l.connectionId);
        return (
          <p key={l.id} className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">
            {conn ? storeLabel(conn) : "Store"}: {l.lastError}
          </p>
        );
      })}

      {item.status === "draft" && item.batchId && (
        <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800">
          The AI wrote this draft. Check the details and price, add the store categories, then set Status to Active to
          list it.
          {item.draftNotes.priceNote && <> Price reasoning: {item.draftNotes.priceNote}</>}
        </p>
      )}

      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts
            <img key={img.id} src={img.url} alt="" className="h-24 w-24 flex-none rounded object-cover" />
          ))}
        </div>
      )}

      <ItemForm
        action={saveItem.bind(null, item.id)}
        itemId={item.id}
        submitLabel="Save and sync"
        stores={storeOptions(conns, item.listings)}
        values={{
          title: item.title,
          sku: item.sku,
          description: item.description,
          price: formatPrice(item.priceCents),
          cost: item.costCents === null ? "" : formatPrice(item.costCents),
          quantity: item.quantity,
          condition: item.condition,
          brand: item.brand ?? "",
          status: item.status === "active" ? "active" : "draft",
          imageUrls: images.map((i) => i.url).join("\n"),
          specifics: formatSpecifics(item.attributes),
          categoryHint: item.draftNotes.categoryQuery,
          skuLocked: item.listings.some((l) => l.remoteOfferId || l.remoteListingId),
        }}
      />
    </div>
  );
}

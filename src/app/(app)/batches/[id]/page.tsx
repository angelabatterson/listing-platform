import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BatchBoard, type BoardGroup, type BoardPhoto } from "@/components/batch-board";
import { DeleteBatchButton } from "@/components/delete-batch-button";
import { PhotoUploader } from "@/components/photo-uploader";
import { ReviewBoard } from "@/components/review-board";
import { db } from "@/db";
import { batches, connections, items, photos } from "@/db/schema";
import { aiIsConfigured } from "@/lib/ai/client";
import { batchSku } from "@/lib/ai/draft";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/billing/access";
import { byStoreOrder, MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";
import { isConnectionReady } from "@/lib/stores";
import { photoUrl } from "@/lib/photos/links";
import { postingProblems } from "@/lib/review";

// Writing listings calls the AI, which can take a while for photo-heavy items.
export const maxDuration = 300;

export default async function BatchPage(props: PageProps<"/batches/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  const batch = await db.query.batches.findFirst({
    where: and(eq(batches.id, id), eq(batches.organizationId, user.organizationId)),
  });
  if (!batch) notFound();

  const [photoRows, drafted, access, orgStores] = await Promise.all([
    db
      .select({ id: photos.id, groupKey: photos.groupKey, itemId: photos.itemId, fileName: photos.fileName })
      .from(photos)
      .where(eq(photos.batchId, batch.id))
      .orderBy(asc(photos.position), asc(photos.createdAt)),
    db.query.items.findMany({
      where: and(eq(items.batchId, batch.id), eq(items.organizationId, user.organizationId)),
      orderBy: asc(items.createdAt),
      with: { images: true, listings: { with: { connection: true } } },
    }),
    getAccess(user),
    db.query.connections.findMany({ where: eq(connections.organizationId, user.organizationId) }),
  ]);

  const open = photoRows.filter((p) => !p.itemId);
  const toBoard = (p: (typeof open)[number]): BoardPhoto => ({
    id: p.id,
    thumbUrl: photoUrl(p.id, "thumb"),
    fullUrl: photoUrl(p.id),
    fileName: p.fileName,
  });
  const groups = new Map<number, BoardGroup>();
  for (const p of open) {
    if (p.groupKey === null) continue;
    const group = groups.get(p.groupKey) ?? { key: p.groupKey, sku: batchSku(batch.number, p.groupKey), photos: [] };
    group.photos.push(toBoard(p));
    groups.set(p.groupKey, group);
  }
  const drafts = drafted.filter((i) => i.status === "draft");
  const posted = drafted.filter((i) => i.status !== "draft");
  const thumbFor = new Map(photoRows.filter((p) => p.itemId).map((p) => [p.itemId!, p.id] as const));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link href="/batches" className="text-sm text-zinc-600 hover:underline">← Photo batches</Link>
          <h1 className="text-2xl font-semibold">Batch B{batch.number}</h1>
        </div>
        <DeleteBatchButton batchId={batch.id} number={batch.number} itemCount={drafted.length} />
      </div>

      <PhotoUploader batchId={batch.id} photoCount={photoRows.length} limit={access.limits.photosPerBatch} />

      <BatchBoard
        batchId={batch.id}
        unsorted={open.filter((p) => p.groupKey === null).map(toBoard)}
        groups={[...groups.values()].sort((a, b) => a.key - b.key)}
        aiReady={aiIsConfigured()}
      />

      {drafts.length > 0 && (
        <ReviewBoard
          batchId={batch.id}
          drafts={drafts.map((item) => {
            const thumb = thumbFor.get(item.id);
            return {
              id: item.id,
              sku: item.sku,
              title: item.title,
              price: formatPrice(item.priceCents),
              condition: item.condition,
              thumbUrl: thumb ? photoUrl(thumb, "thumb") : null,
              photoUrls: [...item.images].sort((a, b) => a.position - b.position).map((i) => i.url),
              priceNote: item.draftNotes.priceNote,
              skuNote: item.draftNotes.skuNote,
              stores: byStoreOrder(orgStores).map((c) => ({
                connectionId: c.id,
                label: MARKETPLACE_LABELS[c.marketplace],
                enabled: item.listings.some((l) => l.connectionId === c.id && l.enabled),
                ready: isConnectionReady(c),
              })),
              problems: postingProblems(item),
            };
          })}
        />
      )}

      {posted.length > 0 && (
        <section className="card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Posted ({posted.length})</h2>
            {drafts.length === 0 && (
              <a href={`/api/batches/${batch.id}/export`} className="btn-secondary">Download CSV</a>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-zinc-100">
            {posted.map((item) => {
              const thumb = thumbFor.get(item.id);
              const failing = item.listings.filter((l) => l.status === "error");
              return (
                <li key={item.id} className="flex items-center gap-4 py-3">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed thumbnails, already small
                    <img src={photoUrl(thumb, "thumb")} alt="" className="h-12 w-12 rounded object-cover" />
                  ) : (
                    <div className="h-12 w-12 rounded bg-zinc-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/items/${item.id}`} className="font-medium hover:underline">{item.title}</Link>
                    <p className="text-sm text-zinc-600">
                      <span className="font-mono text-xs">{item.sku}</span> · ${formatPrice(item.priceCents)}
                      {failing.length > 0 && <span className="text-red-700"> · needs attention</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

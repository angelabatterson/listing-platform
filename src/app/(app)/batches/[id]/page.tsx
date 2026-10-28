import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BatchBoard, type BoardGroup, type BoardPhoto } from "@/components/batch-board";
import { PhotoUploader } from "@/components/photo-uploader";
import { db } from "@/db";
import { batches, items, photos } from "@/db/schema";
import { aiIsConfigured } from "@/lib/ai/client";
import { batchSku } from "@/lib/ai/draft";
import { requireUser } from "@/lib/auth";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";
import { photoUrl } from "@/lib/photos/links";
import { discardDraft } from "../actions";

// Writing listings calls the AI, which can take a while for photo-heavy items.
export const maxDuration = 300;

export default async function BatchPage(props: PageProps<"/batches/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  const batch = await db.query.batches.findFirst({
    where: and(eq(batches.id, id), eq(batches.organizationId, user.organizationId)),
  });
  if (!batch) notFound();

  const [photoRows, drafted] = await Promise.all([
    db
      .select({ id: photos.id, groupKey: photos.groupKey, itemId: photos.itemId, fileName: photos.fileName })
      .from(photos)
      .where(eq(photos.batchId, batch.id))
      .orderBy(asc(photos.position), asc(photos.createdAt)),
    db.query.items.findMany({
      where: and(eq(items.batchId, batch.id), eq(items.organizationId, user.organizationId)),
      orderBy: asc(items.createdAt),
    }),
  ]);

  const open = photoRows.filter((p) => !p.itemId);
  const toBoard = (p: (typeof open)[number]): BoardPhoto => ({
    id: p.id,
    thumbUrl: photoUrl(p.id, "thumb"),
    fileName: p.fileName,
  });
  const groups = new Map<number, BoardGroup>();
  for (const p of open) {
    if (p.groupKey === null) continue;
    const group = groups.get(p.groupKey) ?? { key: p.groupKey, sku: batchSku(batch.number, p.groupKey), photos: [] };
    group.photos.push(toBoard(p));
    groups.set(p.groupKey, group);
  }
  const thumbFor = new Map(photoRows.filter((p) => p.itemId).map((p) => [p.itemId!, p.id] as const));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/batches" className="text-sm text-zinc-600 hover:underline">← Photo batches</Link>
        <h1 className="text-2xl font-semibold">Batch B{batch.number}</h1>
      </div>

      <PhotoUploader batchId={batch.id} photoCount={photoRows.length} />

      <BatchBoard
        batchId={batch.id}
        unsorted={open.filter((p) => p.groupKey === null).map(toBoard)}
        groups={[...groups.values()].sort((a, b) => a.key - b.key)}
        aiReady={aiIsConfigured()}
      />

      {drafted.length > 0 && (
        <section className="card">
          <h2 className="mb-1 text-lg font-semibold">Drafted listings ({drafted.length})</h2>
          <p className="mb-4 text-sm text-zinc-600">
            These are saved as drafts. Open each one to check it, then set it to Active to list it.
          </p>
          <ul className="flex flex-col divide-y divide-zinc-100">
            {drafted.map((item) => {
              const thumb = thumbFor.get(item.id);
              return (
                <li key={item.id} className="flex items-center gap-4 py-3">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed thumbnails, already small
                    <img src={photoUrl(thumb, "thumb")} alt="" className="h-16 w-16 rounded object-cover" />
                  ) : (
                    <div className="h-16 w-16 rounded bg-zinc-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/items/${item.id}`} className="font-medium hover:underline">{item.title}</Link>
                    <p className="text-sm text-zinc-600">
                      <span className="font-mono text-xs">{item.sku}</span> · ${formatPrice(item.priceCents)} ·{" "}
                      {item.status === "draft" ? "Draft" : item.status === "active" ? "Active" : item.status}
                    </p>
                    {item.draftNotes.priceNote && <p className="text-xs text-zinc-500">Price: {item.draftNotes.priceNote}</p>}
                  </div>
                  {item.status === "draft" && (
                    <form action={discardDraft.bind(null, item.id)}>
                      <button className="text-sm text-zinc-600 underline">Discard and redo</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

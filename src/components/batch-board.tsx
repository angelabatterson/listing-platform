"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePhoto, draftItem, movePhoto, sortPhotos } from "@/app/(app)/batches/actions";
import { eachLimited } from "@/lib/photos/resize";

export type BoardPhoto = { id: string; thumbUrl: string; fileName: string | null };
export type BoardGroup = { key: number; sku: string; photos: BoardPhoto[] };

function PhotoTile(props: { photo: BoardPhoto; groups: BoardGroup[]; current: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const busy = pending || props.disabled;
  return (
    <div className={`flex w-28 flex-col gap-1 ${pending ? "opacity-50" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed thumbnails, already small */}
      <img src={props.photo.thumbUrl} alt={props.photo.fileName ?? ""} className="h-28 w-28 rounded object-cover" />
      <select
        aria-label="Move photo"
        className="rounded border border-zinc-300 px-1 py-0.5 text-xs"
        value={props.current}
        disabled={busy}
        onChange={(e) => {
          const target = e.currentTarget.value;
          startTransition(() => movePhoto(props.photo.id, target));
        }}
      >
        <option value="unsorted">Unsorted</option>
        {props.groups.map((g) => (
          <option key={g.key} value={String(g.key)}>
            Item {g.sku}
          </option>
        ))}
        <option value="new">New item</option>
      </select>
      <button
        type="button"
        className="text-left text-xs text-red-700 underline disabled:opacity-50"
        disabled={busy}
        onClick={() => startTransition(() => deletePhoto(props.photo.id))}
      >
        Remove
      </button>
    </div>
  );
}

export function BatchBoard(props: {
  batchId: string;
  unsorted: BoardPhoto[];
  groups: BoardGroup[];
  aiReady: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  async function sort() {
    setWorking(true);
    setErrors([]);
    setStatus(`Sorting ${props.unsorted.length} photos into items…`);
    const result = await sortPhotos(props.batchId);
    setErrors(result.error ? [result.error] : []);
    setStatus(null);
    setWorking(false);
    router.refresh();
  }

  async function draftAll() {
    setWorking(true);
    const problems: string[] = [];
    let done = 0;
    setErrors([]);
    setStatus(`Writing listings: 0 of ${props.groups.length} done…`);
    await eachLimited(props.groups, 3, async (group) => {
      const result = await draftItem(props.batchId, group.key).catch((err: unknown) => ({
        error: err instanceof Error ? err.message : String(err),
      }));
      if (result.error) problems.push(`Item ${group.sku}: ${result.error}`);
      done++;
      setStatus(`Writing listings: ${done} of ${props.groups.length} done…`);
    });
    setErrors(problems);
    setStatus(null);
    setWorking(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {!props.aiReady && (
        <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800">
          The AI assistant isn&apos;t switched on for this server yet, so photos can be uploaded and sorted by hand but
          listings can&apos;t be written automatically.
        </p>
      )}
      {status && <p className="rounded-md bg-zinc-100 px-4 py-2 text-sm">{status}</p>}
      {errors.length > 0 && (
        <ul className="list-disc rounded-md bg-red-50 py-2 pl-9 pr-4 text-sm text-red-800">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {props.unsorted.length > 0 && (
        <section className="card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">New photos ({props.unsorted.length})</h2>
              <p className="text-sm text-zinc-600">Let the AI group them by item, or move each photo by hand.</p>
            </div>
            <button type="button" className="btn" onClick={sort} disabled={working || !props.aiReady}>
              Sort into items
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {props.unsorted.map((p) => (
              <PhotoTile key={p.id} photo={p} groups={props.groups} current="unsorted" disabled={working} />
            ))}
          </div>
        </section>
      )}

      {props.groups.length > 0 && (
        <section className="card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                Ready to write ({props.groups.length} {props.groups.length === 1 ? "item" : "items"})
              </h2>
              <p className="text-sm text-zinc-600">Check each item has the right photos. The first photo becomes the main one.</p>
            </div>
            <button type="button" className="btn" onClick={draftAll} disabled={working || !props.aiReady}>
              Write {props.groups.length === 1 ? "listing" : `${props.groups.length} listings`}
            </button>
          </div>
          <div className="flex flex-col gap-4">
            {props.groups.map((g) => (
              <div key={g.key} className="rounded-md border border-zinc-200 p-3">
                <p className="mb-2 font-mono text-xs text-zinc-600">{g.sku}</p>
                <div className="flex flex-wrap gap-3">
                  {g.photos.map((p) => (
                    <PhotoTile key={p.id} photo={p} groups={props.groups} current={String(g.key)} disabled={working} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

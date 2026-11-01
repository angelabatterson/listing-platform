"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePhotos, draftItem, movePhoto, sortPhotos } from "@/app/(app)/batches/actions";
import { eachLimited } from "@/lib/photos/resize";
import { PhotoViewer } from "./photo-viewer";

export type BoardPhoto = { id: string; thumbUrl: string; fullUrl: string; fileName: string | null };
export type BoardGroup = { key: number; sku: string; photos: BoardPhoto[] };

function PhotoTile(props: {
  photo: BoardPhoto;
  groups: BoardGroup[];
  current: string;
  disabled: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onZoom: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const busy = pending || props.disabled;
  return (
    <div className={`flex w-28 flex-col gap-1 ${pending ? "opacity-50" : ""}`}>
      <div className="relative">
        <button type="button" className="block" onClick={props.onZoom} title="Click to see it bigger">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed thumbnails, already small */}
          <img
            src={props.photo.thumbUrl}
            alt={props.photo.fileName ?? ""}
            className={`h-28 w-28 rounded object-cover ${props.selected ? "ring-2 ring-red-600" : ""}`}
          />
        </button>
        <input
          type="checkbox"
          aria-label="Pick this photo"
          className="absolute left-1 top-1 h-4 w-4"
          checked={props.selected}
          disabled={busy}
          onChange={(e) => props.onSelect(e.currentTarget.checked)}
        />
      </div>
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
        onClick={() => startTransition(() => deletePhotos([props.photo.id]))}
      >
        Delete
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<{ urls: string[]; index: number } | null>(null);

  const all = [...props.unsorted, ...props.groups.flatMap((g) => g.photos)];
  const pickedIds = all.filter((p) => picked.has(p.id)).map((p) => p.id);

  function pick(id: string, on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function pickAll(list: BoardPhoto[], on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const p of list) if (on) next.add(p.id);
      else next.delete(p.id);
      return next;
    });
  }

  async function deletePicked() {
    const n = pickedIds.length;
    if (!window.confirm(`Delete ${n} ${n === 1 ? "photo" : "photos"}? This can't be undone.`)) return;
    setWorking(true);
    setErrors([]);
    try {
      await deletePhotos(pickedIds);
      setPicked(new Set());
    } catch {
      setErrors(["Couldn't delete those photos. Try again."]);
    }
    setWorking(false);
    router.refresh();
  }

  const tile = (p: BoardPhoto, current: string, list: BoardPhoto[]) => (
    <PhotoTile
      key={p.id}
      photo={p}
      groups={props.groups}
      current={current}
      disabled={working}
      selected={picked.has(p.id)}
      onSelect={(on) => pick(p.id, on)}
      onZoom={() => setZoom({ urls: list.map((x) => x.fullUrl), index: list.indexOf(p) })}
    />
  );

  const pickToggle = (list: BoardPhoto[]) => {
    const allOn = list.every((p) => picked.has(p.id));
    return (
      <button type="button" className="text-xs underline disabled:opacity-50" disabled={working} onClick={() => pickAll(list, !allOn)}>
        {allOn ? "Unpick all" : "Pick all"}
      </button>
    );
  };

  // Big batches are sorted a chunk at a time; each call says how many photos are left.
  async function sort() {
    setWorking(true);
    setErrors([]);
    const total = props.unsorted.length;
    let remaining = total;
    while (remaining > 0) {
      setStatus(`Sorting photos into items: ${total - remaining} of ${total} done…`);
      const result = await sortPhotos(props.batchId).catch((err: unknown) => ({
        error: err instanceof Error ? err.message : String(err),
        remaining: undefined,
      }));
      if (result.error || result.remaining === undefined || result.remaining >= remaining) {
        if (result.error) setErrors([result.error]);
        break;
      }
      remaining = result.remaining;
    }
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

      {pickedIds.length > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm">
          <span>
            {pickedIds.length} {pickedIds.length === 1 ? "photo" : "photos"} picked
          </span>
          <div className="flex items-center gap-3">
            <button type="button" className="underline" onClick={() => setPicked(new Set())} disabled={working}>
              Clear
            </button>
            <button type="button" className="btn bg-red-700 hover:bg-red-800" onClick={deletePicked} disabled={working}>
              Delete {pickedIds.length === 1 ? "photo" : `${pickedIds.length} photos`}
            </button>
          </div>
        </div>
      )}

      {props.unsorted.length > 0 && (
        <section className="card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">New photos ({props.unsorted.length})</h2>
              <p className="text-sm text-zinc-600">Let the AI group them by item, or move each photo by hand.</p>
              <p className="text-xs text-zinc-500">Click a photo to see it bigger. Tick photos to delete several at once. {pickToggle(props.unsorted)}</p>
            </div>
            <button type="button" className="btn" onClick={sort} disabled={working || !props.aiReady}>
              Sort into items
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {props.unsorted.map((p) => tile(p, "unsorted", props.unsorted))}
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
                <div className="mb-2 flex items-center gap-3">
                  <p className="font-mono text-xs text-zinc-600">{g.sku}</p>
                  {pickToggle(g.photos)}
                </div>
                <div className="flex flex-wrap gap-3">
                  {g.photos.map((p) => tile(p, String(g.key), g.photos))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {zoom && (
        <PhotoViewer
          urls={zoom.urls}
          index={zoom.index}
          onIndex={(index) => setZoom({ ...zoom, index })}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

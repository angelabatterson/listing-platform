"use client";

import { useRef, useState, type DragEvent } from "react";
import { MAX_PHOTOS_PER_ITEM } from "@/lib/photos/limits";
import { relisticPhotoFile } from "@/lib/photos/background";
import { eachLimited, isImageFile, preparePhoto } from "@/lib/photos/resize";
import { PhotoViewer } from "./photo-viewer";

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

const thumbOf = (url: string) => (relisticPhotoFile(url) ? url.replace(/\.jpg$/, "-thumb.jpg") : url);

// Uploads one photo for an item (not part of a batch) and returns its link.
async function uploadPhoto(file: File): Promise<string> {
  const { photo, thumb } = await preparePhoto(file);
  const body = new FormData();
  body.set("photo", photo, file.name);
  body.set("thumb", thumb, file.name);
  const res = await fetch("/api/photos/upload", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? `${file.name}: upload failed.`);
  return json.url;
}

// Marks a drag that moves a photo already on the item, as opposed to files from the computer.
const MOVE_TYPE = "application/x-relistic-photo";

// The item's photos: drag them into order (the first is the main photo), drop or choose
// new photos from the computer, click one to see it bigger, delete it, or remove its
// background for free. Nothing is kept until the seller presses Save.
export function PhotoLinks(props: { defaultValue: string }) {
  const [text, setText] = useState(props.defaultValue);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<number | null>(null);
  const urls = lines(text);

  const setUrls = (next: string[]) => setText(next.join("\n"));

  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= urls.length) return;
    const next = [...urls];
    [next[i], next[j]] = [next[j], next[i]];
    setUrls(next);
    setStatus("Photo order changed. Press Save to keep it.");
  }

  function moveTo(from: number, to: number) {
    if (from === to) return;
    const next = [...urls];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setUrls(next);
    setStatus("Photo order changed. Press Save to keep it.");
  }

  async function addFiles(list: FileList | null) {
    const files = [...(list ?? [])].filter(isImageFile);
    if (files.length === 0) return;
    const room = MAX_PHOTOS_PER_ITEM - urls.length;
    if (room <= 0) return setError(`An item can have up to ${MAX_PHOTOS_PER_ITEM} photos.`);
    const chosen = files.slice(0, room);
    setError(null);
    setUploading({ done: 0, total: chosen.length });
    const added: string[] = new Array(chosen.length);
    const failed: string[] = [];
    await eachLimited(chosen, 3, async (file, i) => {
      try {
        added[i] = await uploadPhoto(file);
      } catch (err) {
        failed.push(err instanceof Error ? err.message : `${file.name}: upload failed.`);
      }
      setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
    });
    setUploading(null);
    const ok = added.filter(Boolean);
    if (ok.length) {
      setText((current) => [...lines(current), ...ok].join("\n"));
      setStatus(`${ok.length} ${ok.length === 1 ? "photo" : "photos"} added. Press Save to keep ${ok.length === 1 ? "it" : "them"}.`);
    }
    if (files.length > chosen.length) failed.push(`Only ${MAX_PHOTOS_PER_ITEM} photos fit on one item, so ${files.length - chosen.length} were left out.`);
    if (failed.length) setError(failed.join(" "));
  }

  function onDrop(e: DragEvent, to?: number) {
    e.preventDefault();
    e.stopPropagation();
    setDropOver(false);
    if (e.dataTransfer.types.includes(MOVE_TYPE)) {
      if (dragFrom !== null) moveTo(dragFrom, to ?? urls.length - 1);
    } else {
      void addFiles(e.dataTransfer.files);
    }
    setDragFrom(null);
  }

  function remove(i: number) {
    setUrls(urls.filter((_, k) => k !== i));
    setStatus("Photo taken off this item. Press Save to keep the change.");
  }

  const swap = (from: string, to: string) =>
    setText((current) => lines(current).map((u) => (u === from ? to : u)).join("\n"));

  async function removeBg(url: string) {
    const source = relisticPhotoFile(url);
    if (!source) return;
    setBusy(url);
    setError(null);
    setStatus("Getting the background tool ready…");
    try {
      const { removeBackground } = await import("@/lib/photos/background");
      const { photo, thumb } = await removeBackground(url, (percent) =>
        setStatus(`Downloading the background tool (first time only): ${percent}%`),
      );
      setStatus("Saving the new photo…");
      const body = new FormData();
      body.set("source", source);
      body.set("photo", photo, "photo.jpg");
      body.set("thumb", thumb, "thumb.jpg");
      const res = await fetch("/api/photos/edits", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Couldn't save the new photo.");
      swap(url, json.url);
      setOriginals((o) => ({ ...o, [json.url!]: url }));
      setStatus("Background removed. Press Save to use the new photo on your stores.");
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Couldn't remove the background. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function undo(url: string) {
    swap(url, originals[url]);
    setOriginals((o) => Object.fromEntries(Object.entries(o).filter(([edited]) => edited !== url)));
    setStatus("Original photo put back. Press Save to keep it.");
  }

  const busyNow = busy !== null || uploading !== null;
  return (
    <div
      className={`sm:col-span-2 rounded-lg ${dropOver ? "bg-zinc-50 outline-2 outline-dashed outline-zinc-400" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!e.dataTransfer.types.includes(MOVE_TYPE)) setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false);
      }}
      onDrop={(e) => onDrop(e)}
    >
      <input type="hidden" name="imageUrls" value={text} />
      <p className="label">Photos ({urls.length})</p>
      {urls.length === 0 ? (
        <p className="text-sm text-zinc-500">No photos yet. Drag photos here, or click Add photos.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {urls.map((url, i) => (
            <li
              key={`${url}-${i}`}
              draggable={!busyNow}
              onDragStart={(e) => {
                e.dataTransfer.setData(MOVE_TYPE, String(i));
                e.dataTransfer.effectAllowed = "move";
                setDragFrom(i);
              }}
              onDragEnd={() => setDragFrom(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, i)}
              className={`flex w-32 cursor-grab flex-col gap-1 text-xs ${dragFrom === i ? "opacity-40" : ""}`}
            >
              <button type="button" className="relative block" onClick={() => setZoom(i)} title="Click to see it bigger">
                {/* eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts */}
                <img src={thumbOf(url)} alt={`Photo ${i + 1}`} className="h-32 w-32 rounded-md border border-zinc-200 bg-white object-contain" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-zinc-900/80 px-1.5 py-0.5 text-[10px] text-white">Main</span>}
              </button>
              <div className="flex items-center justify-between">
                <button type="button" aria-label="Move left" className="rounded border border-zinc-300 px-2 disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0 || busyNow}>
                  ←
                </button>
                <button type="button" className="text-red-700 underline disabled:opacity-50" onClick={() => remove(i)} disabled={busy !== null}>
                  Delete
                </button>
                <button type="button" aria-label="Move right" className="rounded border border-zinc-300 px-2 disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === urls.length - 1 || busyNow}>
                  →
                </button>
              </div>
              {relisticPhotoFile(url) && (
                <button type="button" className="text-left underline disabled:opacity-50" onClick={() => removeBg(url)} disabled={busy !== null}>
                  {busy === url ? "Working…" : "Remove background"}
                </button>
              )}
              {originals[url] && (
                <button type="button" className="text-left underline" onClick={() => undo(url)} disabled={busy !== null}>
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" onClick={() => picker.current?.click()} disabled={busyNow}>
          Add photos
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading && <span className="text-sm text-zinc-600">Uploading {uploading.done} of {uploading.total}…</span>}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Drag photos to change the order; the first one is the main photo. Drop photos from your computer here to add them.
        Click a photo to see it bigger.
      </p>
      {status && <p className="mt-2 text-sm text-zinc-600">{status}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {urls.some((u) => !relisticPhotoFile(u)) && (
        <p className="mt-1 text-xs text-zinc-500">
          Background removal works on photos uploaded to Relistic through a photo batch.
        </p>
      )}
      {zoom !== null && <PhotoViewer urls={urls} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

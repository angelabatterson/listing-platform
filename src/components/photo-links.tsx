"use client";

import { useState } from "react";
import { relisticPhotoFile } from "@/lib/photos/background";
import { PhotoViewer } from "./photo-viewer";

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

const thumbOf = (url: string) => (relisticPhotoFile(url) ? url.replace(/\.jpg$/, "-thumb.jpg") : url);

// The item's photos: click one to see it bigger, move it left or right (the first is the
// main photo), delete it, or remove its background for free. Changes only touch the
// links here; the seller presses Save to use them. The raw links can still be edited.
export function PhotoLinks(props: { defaultValue: string }) {
  const [text, setText] = useState(props.defaultValue);
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

  return (
    <div className="sm:col-span-2">
      <p className="label">Photos ({urls.length})</p>
      {urls.length === 0 ? (
        <p className="text-sm text-zinc-500">No photos yet. Upload them in a photo batch, or paste photo links below.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {urls.map((url, i) => (
            <li key={`${url}-${i}`} className="flex w-32 flex-col gap-1 text-xs">
              <button type="button" className="relative block" onClick={() => setZoom(i)} title="Click to see it bigger">
                {/* eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts */}
                <img src={thumbOf(url)} alt={`Photo ${i + 1}`} className="h-32 w-32 rounded-md border border-zinc-200 bg-white object-contain" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-zinc-900/80 px-1.5 py-0.5 text-[10px] text-white">Main</span>}
              </button>
              <div className="flex items-center justify-between">
                <button type="button" aria-label="Move left" className="rounded border border-zinc-300 px-2 disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0 || busy !== null}>
                  ←
                </button>
                <button type="button" className="text-red-700 underline disabled:opacity-50" onClick={() => remove(i)} disabled={busy !== null}>
                  Delete
                </button>
                <button type="button" aria-label="Move right" className="rounded border border-zinc-300 px-2 disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === urls.length - 1 || busy !== null}>
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
      <p className="mt-2 text-xs text-zinc-500">
        The first photo is the main one. Click a photo to see it bigger. Use the arrows to change the order.
      </p>
      {status && <p className="mt-2 text-sm text-zinc-600">{status}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {urls.some((u) => !relisticPhotoFile(u)) && (
        <p className="mt-1 text-xs text-zinc-500">
          Background removal works on photos uploaded to Relistic through a photo batch.
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-zinc-600">Add or edit photo links</summary>
        <label className="label mt-2" htmlFor="imageUrls">Photo links (one per line, https://)</label>
        <textarea
          id="imageUrls"
          name="imageUrls"
          rows={3}
          className="input font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </details>
      {zoom !== null && <PhotoViewer urls={urls} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

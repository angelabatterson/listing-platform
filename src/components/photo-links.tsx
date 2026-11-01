"use client";

import { useState } from "react";
import { relisticPhotoFile } from "@/lib/photos/background";

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

const thumbOf = (url: string) => (relisticPhotoFile(url) ? url.replace(/\.jpg$/, "-thumb.jpg") : url);

// The item's photo links, with a preview of each photo and a free "Remove background"
// button for photos uploaded to Relistic. Edits only change the links here; the seller
// presses Save to use them, and Undo puts the original photo back.
export function PhotoLinks(props: { defaultValue: string }) {
  const [text, setText] = useState(props.defaultValue);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const urls = lines(text);

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
      <label className="label" htmlFor="imageUrls">Photo links (one per line, https://)</label>
      <textarea
        id="imageUrls"
        name="imageUrls"
        rows={3}
        className="input font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="mt-1 text-xs text-zinc-500">
        The first photo is the main one. Upload photos from a photo batch, or paste links to hosted photos.
      </p>
      {urls.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {urls.map((url, i) => (
            <li key={`${url}-${i}`} className="flex w-28 flex-col gap-1 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts */}
              <img src={thumbOf(url)} alt={`Photo ${i + 1}`} className="h-28 w-28 rounded-md border border-zinc-200 bg-white object-contain" />
              {relisticPhotoFile(url) && (
                <button type="button" className="underline disabled:opacity-50" onClick={() => removeBg(url)} disabled={busy !== null}>
                  {busy === url ? "Working…" : "Remove background"}
                </button>
              )}
              {originals[url] && (
                <button type="button" className="underline" onClick={() => undo(url)} disabled={busy !== null}>
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status && <p className="mt-2 text-sm text-zinc-600">{status}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {urls.some((u) => !relisticPhotoFile(u)) && (
        <p className="mt-1 text-xs text-zinc-500">
          Background removal works on photos uploaded to Relistic through a photo batch.
        </p>
      )}
    </div>
  );
}

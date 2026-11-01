"use client";

import { useEffect } from "react";

// A full-size view of one photo, with arrows to step through the rest. Closes on
// Escape, the Close button, or a click on the dark background.
export function PhotoViewer(props: {
  urls: string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { urls, index, onIndex, onClose } = props;
  const count = urls.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && count > 1) onIndex((index - 1 + count) % count);
      if (e.key === "ArrowRight" && count > 1) onIndex((index + 1) % count);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onIndex, onClose]);

  if (!urls[index]) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${count}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex items-center justify-between text-sm text-white">
        <span>
          Photo {index + 1} of {count}
        </span>
        <div className="flex gap-3">
          <a href={urls[index]} target="_blank" rel="noreferrer" className="underline">
            Open full size
          </a>
          <button type="button" className="rounded bg-white/20 px-3 py-1 hover:bg-white/30" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-3 py-3" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {count > 1 && (
          <button
            type="button"
            aria-label="Previous photo"
            className="rounded-full bg-white/20 px-3 py-2 text-2xl text-white hover:bg-white/30"
            onClick={() => onIndex((index - 1 + count) % count)}
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts */}
        <img src={urls[index]} alt={`Photo ${index + 1}`} className="max-h-full min-w-0 max-w-full rounded bg-white object-contain" />
        {count > 1 && (
          <button
            type="button"
            aria-label="Next photo"
            className="rounded-full bg-white/20 px-3 py-2 text-2xl text-white hover:bg-white/30"
            onClick={() => onIndex((index + 1) % count)}
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}

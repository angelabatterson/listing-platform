"use client";

import { useCallback, useState } from "react";
import { StoreListingDialog } from "./store-listing-dialog";

export type StoreCellListing = { status: string; priceCents: number; link: string | null; error: string | null };

const statusStyles: Record<string, string> = {
  listed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  ended: "bg-zinc-100 text-zinc-600",
  waiting: "bg-amber-100 text-amber-900",
};

const statusText: Record<string, string> = {
  listed: "Listed",
  error: "Needs attention",
  ended: "Ended",
  waiting: "Waiting in extension",
  not_listed: "Not live yet",
};

// One store's column on the Inventory page: the listing's price and status, or a
// "List on" box. Either opens the store's pop-up.
export function StoreCell(props: {
  itemId: string;
  itemTitle: string;
  connectionId: string;
  storeName: string;
  listing: StoreCellListing | null;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const l = props.listing;
  return (
    <>
      {l ? (
        <div className="flex min-w-32 flex-col items-start gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">${(l.priceCents / 100).toFixed(2)}</span>
            {l.link && (
              <a href={l.link} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-900" aria-label={`Open on ${props.storeName}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <path d="M7 17 17 7M8 7h9v9" />
                </svg>
              </a>
            )}
          </div>
          <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${statusStyles[l.status] ?? statusStyles.ended}`} title={l.error ?? undefined}>
            {statusText[l.status] ?? l.status}
          </span>
          <button type="button" onClick={() => setOpen(true)} className="text-xs text-zinc-600 underline hover:text-zinc-900">
            Edit for {props.storeName}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-20 w-32 flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900"
        >
          <span className="text-lg leading-none">+</span>
          List on {props.storeName}
        </button>
      )}
      {open && <StoreListingDialog itemId={props.itemId} connectionId={props.connectionId} itemTitle={props.itemTitle} onClose={close} />}
    </>
  );
}

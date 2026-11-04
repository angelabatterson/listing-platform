"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { findItems, moveListing } from "@/app/(app)/items/inventory-actions";
import { removeFromStore } from "@/app/(app)/items/store-listing-actions";
import { StoreListingDialog } from "./store-listing-dialog";

export type StoreCellListing = { status: string; priceCents: number; link: string | null; error: string | null; photo: string | null };

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
        <div className="flex min-w-28 flex-col items-start gap-1">
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
          <button
            type="button"
            onClick={() => setOpen(true)}
            title={l.error ?? `Edit the ${props.storeName} listing`}
            className="w-24 overflow-hidden rounded-md border border-zinc-200 bg-white text-left hover:border-zinc-400"
          >
            {l.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts
              <img src={l.photo} alt="" className={`h-20 w-full object-cover ${l.status === "ended" ? "opacity-50 grayscale" : ""}`} loading="lazy" />
            ) : (
              <div className="h-20 w-full bg-zinc-100" />
            )}
            <span className={`block truncate px-1 py-0.5 text-center text-xs ${statusStyles[l.status] ?? statusStyles.ended}`}>
              {statusText[l.status] ?? l.status}
            </span>
          </button>
          <StoreMenu {...props} link={l.link} onEdit={() => setOpen(true)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-[6.5rem] w-24 flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900"
        >
          <span className="text-lg leading-none">+</span>
          List on {props.storeName}
        </button>
      )}
      {open && <StoreListingDialog itemId={props.itemId} connectionId={props.connectionId} itemTitle={props.itemTitle} onClose={close} />}
    </>
  );
}

// The ▾ menu on a store cell: view the listing, edit it, take it off the store, or move it.
function StoreMenu(props: {
  itemId: string;
  connectionId: string;
  storeName: string;
  link: string | null;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ id: string; title: string; sku: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // The list sits in a scrolling table, so the menu is placed on the screen itself to avoid being cut off.
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setMoving(false);
      }
    };
    const hide = (e: Event) => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return;
      setOpen(false);
      setMoving(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open]);

  useEffect(() => {
    if (!moving || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      findItems(query, props.itemId).then(setMatches).catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [moving, query, props.itemId]);

  const finish = (text?: string) => {
    if (text) setMessage(text);
    setOpen(false);
    setMoving(false);
    router.refresh();
  };

  const item = "block w-full px-3 py-1.5 text-left hover:bg-zinc-50 disabled:opacity-50";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={toggle}
        onClick={() => {
          const r = toggle.current?.getBoundingClientRect();
          if (r) setPlace({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 264)) });
          setOpen(!open);
        }}
        className="text-xs text-zinc-600 underline hover:text-zinc-900"
      >
        Options ▾
      </button>
      {message && <p className="mt-1 max-w-40 text-xs text-zinc-600">{message}</p>}
      {open && place && (
        <div
          role="menu"
          style={{ top: place.top, left: place.left }}
          className="fixed z-30 max-h-[70vh] w-64 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg"
        >
          {props.link && (
            <a role="menuitem" href={props.link} target="_blank" rel="noreferrer" className={item}>
              View on {props.storeName}
            </a>
          )}
          <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); props.onEdit(); }}>
            Edit for {props.storeName}
          </button>
          <button
            role="menuitem"
            type="button"
            className={`${item} text-red-700`}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Take this item off ${props.storeName}? It stays in Relistic and on your other stores.`)) return;
              startTransition(async () => {
                const result = await removeFromStore(props.itemId, props.connectionId);
                finish(result?.error ?? result?.message);
              });
            }}
          >
            Take off {props.storeName}
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => setMoving(!moving)}>
            Move to another item…
          </button>
          {moving && (
            <div className="border-t border-zinc-100 px-3 py-2">
              <input
                autoFocus
                aria-label="Find the item to move this listing to"
                placeholder="Type a title or SKU"
                className="input py-1 text-sm"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
              />
              <p className="mt-1 text-xs text-zinc-500">The listing stays the same on {props.storeName}; Relistic tracks it under that item instead.</p>
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {query.trim().length >= 2 &&
                  matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left hover:bg-zinc-100 disabled:opacity-50"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await moveListing(props.itemId, props.connectionId, m.id);
                            finish(result.error ?? result.message);
                          })
                        }
                      >
                        <span className="block truncate">{m.title}</span>
                        <span className="font-mono text-xs text-zinc-500">{m.sku}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

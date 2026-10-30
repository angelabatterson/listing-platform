"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { StoreAssist } from "./store-assist";
import { useFormAction } from "./use-form-action";
import {
  loadStoreListing,
  removeFromStore,
  saveStoreListing,
  type StoreListingData,
  type StoreListingState,
} from "@/app/(app)/items/store-listing-actions";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { ETSY_WHEN_MADE } from "@/lib/marketplaces/etsy/config";
import { TITLE_LIMITS } from "@/lib/marketplaces/overrides";
import type { Connection } from "@/db/schema";

const thumbOf = (url: string) => (url.includes("/api/photos/") && !url.endsWith("-thumb.jpg") ? url.replace(/\.jpg$/, "-thumb.jpg") : url);

// A pop-up for one store's version of an item: which photos, title, description, price,
// condition and the store's own fields. Saving lists it there (or updates the listing).
export function StoreListingDialog(props: { itemId: string; connectionId: string; itemTitle: string; onClose: () => void }) {
  const [data, setData] = useState<StoreListingData | null | undefined>(undefined);
  const { onClose } = props;

  useEffect(() => {
    loadStoreListing(props.itemId, props.connectionId).then(setData, () => setData(null));
  }, [props.itemId, props.connectionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={data ? `${props.itemTitle} on ${data.store.label}` : "Store listing"}
        className="w-full max-w-3xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold">
            {data ? (
              <>
                {data.listingStatus === "not_listed" ? "List" : "Edit"} &lsquo;{props.itemTitle}&rsquo; on {data.store.label}
              </>
            ) : (
              props.itemTitle
            )}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {data === undefined && <p className="px-6 py-8 text-sm text-zinc-600">Loading…</p>}
        {data === null && <p className="px-6 py-8 text-sm text-red-600">Couldn&apos;t load this item. Close and try again.</p>}
        {data && <StoreListingForm {...props} data={data} />}
      </div>
    </div>
  );
}

function StoreListingForm(props: { itemId: string; connectionId: string; data: StoreListingData; onClose: () => void }) {
  const { data } = props;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(data.view.title);
  const [removing, startRemove] = useTransition();
  const [removed, setRemoved] = useState<StoreListingState>(undefined);
  const { state, onSubmit, pending } = useFormAction(async (prev: StoreListingState, formData: FormData) => {
    const result = await saveStoreListing(props.itemId, props.connectionId, prev, formData);
    router.refresh();
    return result;
  });
  const marketplace = data.store.marketplace as Connection["marketplace"];
  const limit = TITLE_LIMITS[marketplace];
  const chosen = new Set(data.view.photos);
  const listed = data.listingStatus !== "not_listed" && data.listingStatus !== "ended";
  const result = removed ?? state;

  const remove = () =>
    startRemove(async () => {
      setRemoved(await removeFromStore(props.itemId, props.connectionId));
      router.refresh();
    });

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-6 px-6 py-5">
      {!data.store.ready && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Finish this store&apos;s setup on the Stores page before it can list.
        </p>
      )}
      {data.lastError && !result && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Last try: {data.lastError}</p>
      )}

      <section>
        <h3 className="mb-2 font-medium">Photos for this store</h3>
        {data.item.photos.length === 0 ? (
          <p className="text-sm text-zinc-600">This item has no photos yet. Add them on the item page.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.item.photos.map((url, i) => (
              <label key={url} className="relative cursor-pointer">
                <input type="checkbox" name="photo" value={url} defaultChecked={chosen.has(url)} className="peer absolute left-1.5 top-1.5 h-4 w-4" />
                {/* eslint-disable-next-line @next/next/no-img-element -- photos come from many hosts */}
                <img
                  src={thumbOf(url)}
                  alt={`Photo ${i + 1}`}
                  className="h-20 w-20 rounded-md border-2 border-transparent object-cover opacity-40 peer-checked:border-zinc-900 peer-checked:opacity-100"
                />
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="flex justify-between">
            <label className="label" htmlFor="sl-title">Title</label>
            {limit && (
              <span className={`text-xs ${title.length > limit ? "text-red-600" : "text-zinc-500"}`}>
                {title.length}/{limit}
              </span>
            )}
          </div>
          <input id="sl-title" name="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="sl-description">Description</label>
          <textarea id="sl-description" name="description" rows={6} className="input" defaultValue={data.view.description} />
        </div>
        <div>
          <label className="label" htmlFor="sl-price">Price</label>
          <input id="sl-price" name="price" type="number" step="0.01" min="0.01" className="input" defaultValue={data.view.price} required />
        </div>
        <div>
          <label className="label" htmlFor="sl-condition">Condition</label>
          <select id="sl-condition" name="condition" className="input" defaultValue={data.view.condition}>
            {EBAY_CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        {(marketplace === "ebay" || marketplace === "etsy" || marketplace === "tiktok") && (
          <div className="sm:col-span-2">
            <label className="label" htmlFor={`category_${props.connectionId}`}>
              {marketplace === "ebay" ? "eBay category ID" : marketplace === "etsy" ? "Etsy category ID" : "TikTok Shop category ID (optional)"}
            </label>
            <input id={`category_${props.connectionId}`} name={`category_${props.connectionId}`} className="input" defaultValue={data.categoryId} />
            {(marketplace === "ebay" || marketplace === "etsy") && (
              <StoreAssist
                formRef={formRef}
                itemId={props.itemId}
                connectionId={props.connectionId}
                marketplace={marketplace}
                ready={data.store.ready}
                noSpecifics
              />
            )}
          </div>
        )}
        {marketplace === "etsy" && (
          <div>
            <label className="label" htmlFor="sl-whenMade">When was it made?</label>
            <select id="sl-whenMade" name="whenMade" className="input" defaultValue={data.whenMade}>
              <option value="">Choose…</option>
              {ETSY_WHEN_MADE.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </div>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        Changes here are only for {data.store.label}. Your main item stays the same.
        {data.store.extension && " This store is posted through the Relistic Chrome extension: it fills in the listing and you press Post on the site."}
      </p>

      {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
      {result?.message && <p className="text-sm text-green-700">{result.message}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4">
        <div>
          {listed && (
            <button type="button" className="text-sm text-red-700 underline" onClick={remove} disabled={removing || pending}>
              {removing ? "Taking it down…" : `Take it off ${data.store.label}`}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={props.onClose}>Close</button>
          <button className="btn" disabled={pending || removing}>
            {pending ? "Saving…" : listed ? "Save changes" : `List on ${data.store.label}`}
          </button>
        </div>
      </div>
    </form>
  );
}

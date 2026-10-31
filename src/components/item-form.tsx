"use client";

import { useRef } from "react";
import { PhotoLinks } from "./photo-links";
import { StoreAssist } from "./store-assist";
import { useFormAction } from "./use-form-action";
import type { ItemFormState } from "@/app/(app)/items/actions";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { ETSY_WHEN_MADE } from "@/lib/marketplaces/etsy/config";
import type { Connection } from "@/db/schema";

export type ItemFormValues = {
  title: string;
  sku: string;
  description: string;
  price: string;
  cost: string;
  quantity: number;
  condition: string;
  brand: string;
  tags: string;
  status: "draft" | "active";
  imageUrls: string;
  specifics: string;
  skuLocked: boolean;
  // A search phrase the AI suggested for finding the category, on drafted items.
  categoryHint?: string;
};

export type StoreOption = {
  connectionId: string;
  label: string;
  marketplace: Connection["marketplace"];
  ready: boolean;
  // Posted through the Chrome extension, so there's no category to choose here.
  extension: boolean;
  enabled: boolean;
  categoryId: string;
  whenMade: string;
  price: string;
};

export function ItemForm(props: {
  action: (state: ItemFormState, formData: FormData) => Promise<ItemFormState>;
  values: ItemFormValues;
  stores: StoreOption[];
  submitLabel: string;
  itemId?: string;
}) {
  const { state, onSubmit, pending } = useFormAction(props.action);
  const formRef = useRef<HTMLFormElement>(null);
  const v = props.values;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title">Title</label>
          <input id="title" name="title" className="input" defaultValue={v.title} required maxLength={140} />
          <p className="mt-1 text-xs text-zinc-500">eBay shows the first 80 characters.</p>
        </div>
        <div>
          <label className="label" htmlFor="sku">SKU</label>
          <input
            id="sku"
            name="sku"
            className="input read-only:bg-zinc-100"
            defaultValue={v.sku}
            readOnly={v.skuLocked}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="brand">Brand</label>
          <input id="brand" name="brand" className="input" defaultValue={v.brand} />
        </div>
        <div>
          <label className="label" htmlFor="tags">Tags (optional)</label>
          <input id="tags" name="tags" className="input" defaultValue={v.tags} placeholder="Bin 4, Women's denim" />
          <p className="mt-1 text-xs text-zinc-500">Your own groups, separated by commas. Only you see them.</p>
        </div>
        <div>
          <label className="label" htmlFor="price">Price (USD)</label>
          <input id="price" name="price" type="number" step="0.01" min="0.01" className="input" defaultValue={v.price} required />
        </div>
        <div>
          <label className="label" htmlFor="cost">What you paid (optional)</label>
          <input id="cost" name="cost" type="number" step="0.01" min="0" className="input" defaultValue={v.cost} />
          <p className="mt-1 text-xs text-zinc-500">Only you see this. It&apos;s used for profit on the dashboard.</p>
        </div>
        <div>
          <label className="label" htmlFor="quantity">Quantity</label>
          <input id="quantity" name="quantity" type="number" min="0" className="input" defaultValue={v.quantity} required />
        </div>
        <div>
          <label className="label" htmlFor="condition">Condition</label>
          <select id="condition" name="condition" className="input" defaultValue={v.condition}>
            {EBAY_CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" className="input" defaultValue={v.status}>
            <option value="draft">Draft (not listed anywhere)</option>
            <option value="active">Active (list on the stores ticked below)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="description">Description</label>
          <textarea id="description" name="description" rows={6} className="input" defaultValue={v.description} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="specifics">Item specifics (one per line)</label>
          <textarea
            id="specifics"
            name="specifics"
            rows={5}
            className="input"
            defaultValue={v.specifics}
            placeholder={"Size: M\nColor: Blue\nMaterial: Cotton, Polyester"}
          />
          <p className="mt-1 text-xs text-zinc-500">
            The details buyers filter by on eBay. Write each as &quot;Name: value&quot;, with commas between several values.
          </p>
        </div>
        <PhotoLinks defaultValue={v.imageUrls} />
      </section>

      <section className="card">
        <h2 className="mb-1 text-lg font-semibold">Where to list it</h2>
        <p className="mb-4 text-sm text-zinc-600">Tick each store this item should appear on.</p>
        {props.stores.length === 0 && (
          <p className="text-sm text-zinc-600">Connect a store on the Stores page first.</p>
        )}
        <div className="flex flex-col gap-4">
          {props.stores.map((s) => (
            <div key={s.connectionId} className="rounded-md border border-zinc-200 p-4">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" name={`list_${s.connectionId}`} defaultChecked={s.enabled} />
                {s.label}
              </label>
              {!s.ready && (
                <p className="mt-1 text-xs text-amber-700">Finish this store&apos;s setup on the Stores page before it can list.</p>
              )}
              {s.extension && (
                <p className="mt-1 text-xs text-zinc-500">
                  Posted through the Relistic Chrome extension: it fills in the listing and you press Post on the site.
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(s.marketplace === "ebay" || s.marketplace === "etsy" || s.marketplace === "tiktok") && (
                  <div>
                    <label className="label" htmlFor={`category_${s.connectionId}`}>
                      {s.marketplace === "ebay" ? "eBay category ID" : s.marketplace === "etsy" ? "Etsy category ID" : "TikTok Shop category ID (optional)"}
                    </label>
                    <input id={`category_${s.connectionId}`} name={`category_${s.connectionId}`} className="input" defaultValue={s.categoryId} />
                  </div>
                )}
                {s.marketplace === "etsy" && (
                  <div>
                    <label className="label" htmlFor={`whenMade_${s.connectionId}`}>When was it made?</label>
                    <select id={`whenMade_${s.connectionId}`} name={`whenMade_${s.connectionId}`} className="input" defaultValue={s.whenMade}>
                      <option value="">Choose…</option>
                      {ETSY_WHEN_MADE.map((w) => (
                        <option key={w.value} value={w.value}>{w.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-zinc-500">Etsy only allows resold items that are vintage (20+ years old) or craft supplies.</p>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor={`price_${s.connectionId}`}>Price on this store (optional)</label>
                  <input
                    id={`price_${s.connectionId}`}
                    name={`price_${s.connectionId}`}
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input"
                    placeholder="Same as above"
                    defaultValue={s.price}
                  />
                </div>
              </div>
              {(s.marketplace === "ebay" || s.marketplace === "etsy") && (
                <StoreAssist
                  formRef={formRef}
                  itemId={props.itemId ?? null}
                  connectionId={s.connectionId}
                  marketplace={s.marketplace}
                  ready={s.ready}
                  categoryHint={v.categoryHint}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div>
        <button className="btn" disabled={pending}>{pending ? "Saving and syncing…" : props.submitLabel}</button>
      </div>
    </form>
  );
}

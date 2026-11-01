"use client";

import { useState, useTransition } from "react";
import { saveDraftSettings } from "@/app/(app)/batches/settings/actions";
import { TITLE_PARTS, type TitlePartKey } from "@/lib/ai/title-order";
import { TITLE_LIMITS } from "@/lib/marketplaces/overrides";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";

const EXAMPLE: Record<TitlePartKey, string> = {
  brand: "Levi's",
  department: "Women's",
  type: "Denim Jacket",
  model: "Trucker",
  size: "Size M",
  color: "Blue",
  material: "Cotton",
  pattern: "Solid",
  era: "Vintage 90s",
  features: "Button Front",
  condition: "NWT",
};

const labelOf = (key: TitlePartKey) => TITLE_PARTS.find((p) => p.key === key)!.label;

export function DraftSettingsForm(props: { titleOrder: TitlePartKey[]; skuFromPhoto: boolean }) {
  const [order, setOrder] = useState<TitlePartKey[]>(props.titleOrder);
  const [skuFromPhoto, setSkuFromPhoto] = useState(props.skuFromPhoto);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const unused = TITLE_PARTS.map((p) => p.key).filter((k) => !order.includes(k));

  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setMessage(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveDraftSettings({ titleOrder: order, skuFromPhoto });
      setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: "Saved. New drafts will use these settings." });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Title word order</h2>
          <p className="text-sm text-zinc-600">
            The AI builds each title from these parts, top to bottom, and skips any it can&apos;t tell from the photos.
            Use the arrows to change the order.
          </p>
        </div>
        <ol className="flex flex-col gap-2">
          {order.map((key, i) => (
            <li key={key} className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm">
              <span className="w-5 text-zinc-500">{i + 1}.</span>
              <span className="flex-1 font-medium">{labelOf(key)}</span>
              <button type="button" aria-label={`Move ${labelOf(key)} up`} className="rounded border border-zinc-300 px-2 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" aria-label={`Move ${labelOf(key)} down`} className="rounded border border-zinc-300 px-2 disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="text-red-700 underline disabled:opacity-30" disabled={order.length === 1} onClick={() => setOrder(order.filter((k) => k !== key))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        {unused.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-600">Add a part:</span>
            {unused.map((key) => (
              <button key={key} type="button" className="rounded-full border border-zinc-300 px-3 py-0.5 hover:bg-zinc-50" onClick={() => setOrder([...order, key])}>
                + {labelOf(key)}
              </button>
            ))}
          </div>
        )}
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm">
          <span className="text-zinc-500">Example: </span>
          {order.map((k) => EXAMPLE[k]).join(" ")}
        </p>
        <p className="text-xs text-zinc-500">
          Title limits: {Object.entries(TITLE_LIMITS)
            .map(([m, n]) => `${MARKETPLACE_LABELS[m as keyof typeof MARKETPLACE_LABELS]} ${n}`)
            .join(", ")}{" "}
          characters. The AI keeps the main title to 80 so it fits everywhere, and writes a longer one (up to 140) for Etsy.
        </p>
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your own SKUs</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={skuFromPhoto} onChange={(e) => setSkuFromPhoto(e.currentTarget.checked)} />
          <span>
            Read my SKU from a photo. If you photograph a sticker or card with your own code (like &quot;BIN4-017&quot;), the
            AI uses it as the item&apos;s SKU and leaves that photo off the listing. Without one, items get a batch SKU like
            &quot;B12-3&quot;. You can always change a SKU while reviewing drafts.
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" className="btn" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {message && <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
      </div>
    </div>
  );
}

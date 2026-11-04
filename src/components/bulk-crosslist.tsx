"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { crosslistItem } from "@/app/(app)/items/inventory-actions";
import type { Connection } from "@/db/schema";
import { previewPrice, type CrosslistPrice } from "@/lib/crosslist";
import { formatPrice } from "@/lib/marketplaces/ebay/mapping";
import { TITLE_LIMITS } from "@/lib/marketplaces/overrides";
import { eachLimited } from "@/lib/photos/resize";
import { describeRule, hasRule, type PriceRule } from "@/lib/price-rules";
import { StoreLogo } from "./store-logo";

export type BulkItem = { id: string; title: string; priceCents: number; draft: boolean };
export type BulkStore = { id: string; label: string; marketplace: Connection["marketplace"]; rule?: PriceRule };

type Bulk = { picked: Set<string>; toggle: (id: string, on: boolean) => void; setAll: (on: boolean) => void; ids: string[] };
const BulkContext = createContext<Bulk | null>(null);

// Ticks on the Inventory rows, for listing many items on more stores at once.
export function BulkCrosslist(props: {
  items: BulkItem[];
  stores: BulkStore[];
  children: React.ReactNode;
}) {
  const ids = props.items.map((i) => i.id);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const bulk: Bulk = {
    picked,
    ids,
    toggle: (id, on) =>
      setPicked((s) => {
        const next = new Set(s);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    setAll: (on) => setPicked(on ? new Set(ids) : new Set()),
  };
  return (
    <BulkContext.Provider value={bulk}>
      {props.children}
      {picked.size > 0 && <BulkBar items={props.items} stores={props.stores} onDone={() => setPicked(new Set())} />}
    </BulkContext.Provider>
  );
}

export function RowCheck(props: { itemId: string; title: string }) {
  const bulk = useContext(BulkContext);
  if (!bulk) return null;
  return (
    <input
      type="checkbox"
      aria-label={`Select ${props.title}`}
      checked={bulk.picked.has(props.itemId)}
      onChange={(e) => bulk.toggle(props.itemId, e.currentTarget.checked)}
    />
  );
}

export function SelectAll() {
  const bulk = useContext(BulkContext);
  if (!bulk || !bulk.ids.length) return null;
  const all = bulk.ids.every((id) => bulk.picked.has(id));
  return (
    <input type="checkbox" aria-label="Select every item on this page" checked={all} onChange={(e) => bulk.setAll(e.currentTarget.checked)} />
  );
}

type Result = { title: string; ok: boolean; message?: string };

function BulkBar(props: { items: BulkItem[]; stores: BulkStore[]; onDone: () => void }) {
  const bulk = useContext(BulkContext)!;
  const [open, setOpen] = useState(false);
  const chosen = props.items.filter((i) => bulk.picked.has(i.id));
  const label = `Crosslist ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`;
  return (
    <div className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-300 bg-white p-3 text-sm shadow-lg">
      <span className="font-medium">
        {chosen.length} {chosen.length === 1 ? "item" : "items"} selected
      </span>
      <button type="button" className="btn" onClick={() => setOpen(true)} disabled={!props.stores.length}>
        {label}
      </button>
      <button type="button" className="text-zinc-600 underline" onClick={props.onDone}>
        Clear
      </button>
      {!props.stores.length && <span className="text-zinc-500">Connect a store first, on the Stores page.</span>}
      {open && (
        <CrosslistDialog
          items={chosen}
          stores={props.stores}
          onClose={(finished) => {
            setOpen(false);
            if (finished) props.onDone();
          }}
        />
      )}
    </div>
  );
}

type PriceMode = "rule" | "match" | "up" | "down";
type PriceChoice = { mode: PriceMode; percent: string };
const STEPS = ["Stores and titles", "Prices", "Drafts or publish"];

function toChoice(c: PriceChoice): CrosslistPrice {
  const pct = Math.abs(Number(c.percent) || 0);
  if (c.mode === "up") return { mode: "percent", percent: pct };
  if (c.mode === "down") return { mode: "percent", percent: -Math.min(pct, 90) };
  return { mode: c.mode, percent: 0 };
}

// The "Crosslist items" pop-up: pick stores and title handling, then each store's
// price, then whether to post now or keep the items as drafts.
function CrosslistDialog(props: { items: BulkItem[]; stores: BulkStore[]; onClose: (finished: boolean) => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [stores, setStores] = useState<Set<string>>(() => new Set());
  const [shorten, setShorten] = useState(true);
  const [prices, setPrices] = useState<Record<string, PriceChoice>>({});
  const [publish, setPublish] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const { onClose } = props;
  const n = props.items.length;
  const picked = props.stores.filter((s) => stores.has(s.id));
  const drafts = props.items.filter((i) => i.draft).length;
  const sample = props.items[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !running && onClose(Boolean(results));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running, results]);

  const choiceFor = (s: BulkStore): PriceChoice => prices[s.id] ?? { mode: hasRule(s.rule) ? "rule" : "match", percent: "10" };
  const setChoice = (id: string, c: PriceChoice) => setPrices((p) => ({ ...p, [id]: c }));

  // Titles too long for a picked store.
  const tooLong = picked
    .map((s) => {
      const max = TITLE_LIMITS[s.marketplace];
      return { store: s, max, count: max ? props.items.filter((i) => i.title.length > max).length : 0 };
    })
    .filter((t) => t.count > 0);

  async function run() {
    setRunning(true);
    setDone(0);
    const options = {
      shortenTitles: shorten,
      publish,
      prices: Object.fromEntries(picked.map((s) => [s.id, toChoice(choiceFor(s))])),
    };
    const out: Result[] = [];
    await eachLimited(props.items, 2, async (item) => {
      const r = await crosslistItem(item.id, [...stores], options).catch((err: unknown) => ({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }));
      out.push({ title: item.title, ...r });
      setDone((d) => d + 1);
    });
    setRunning(false);
    setResults(out);
    router.refresh();
  }

  const failed = results?.filter((r) => !r.ok) ?? [];
  const close = () => !running && onClose(Boolean(results));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Crosslist ${n} items`}
        className="w-full max-w-xl rounded-lg bg-white text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              Crosslist {n} {n === 1 ? "item" : "items"}
            </h2>
            {!results && (
              <ol className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                {STEPS.map((label, i) => (
                  <li key={label} className={i === step ? "font-medium text-zinc-900" : ""} aria-current={i === step ? "step" : undefined}>
                    {i + 1}. {label}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100" disabled={running}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {results ? (
            <div className="space-y-2">
              <p className={failed.length ? "text-amber-800" : "text-green-800"}>
                {results.length - failed.length} of {results.length} {publish ? "listed" : "saved as drafts"}.
                {failed.length > 0 && " These need a fix:"}
              </p>
              {failed.length > 0 && (
                <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-amber-900">
                  {failed.map((r, i) => (
                    <li key={i}>
                      <strong>{r.title}:</strong> {r.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : step === 0 ? (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-2 font-medium">Which stores?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {props.stores.map((s) => (
                    <label
                      key={s.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 ${stores.has(s.id) ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}
                    >
                      <input
                        type="checkbox"
                        checked={stores.has(s.id)}
                        onChange={(e) => {
                          const on = e.currentTarget.checked;
                          setStores((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(s.id);
                            else next.delete(s.id);
                            return next;
                          });
                        }}
                      />
                      <StoreLogo marketplace={s.marketplace} />
                      <span className="truncate">{s.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-1">
                <legend className="mb-1 font-medium">Titles</legend>
                <label className="flex items-start gap-2">
                  <input type="radio" name="titles" checked={shorten} onChange={() => setShorten(true)} className="mt-0.5" />
                  <span>
                    Shorten long titles with AI to fit each store
                    <span className="block text-xs text-zinc-500">Only titles over a store&apos;s limit change, and only on that store.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="titles" checked={!shorten} onChange={() => setShorten(false)} className="mt-0.5" />
                  <span>Keep titles as they are</span>
                </label>
                {tooLong.length > 0 && (
                  <ul className={`mt-2 space-y-0.5 text-xs ${shorten ? "text-zinc-600" : "text-amber-800"}`}>
                    {tooLong.map((t) => (
                      <li key={t.store.id}>
                        {t.count} {t.count === 1 ? "title is" : "titles are"} longer than {t.store.label} allows ({t.max} characters)
                        {shorten ? " and will be shortened." : ", so the store may turn them down."}
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            </>
          ) : step === 1 ? (
            <div className="space-y-3">
              <p className="text-zinc-600">
                Each store&apos;s price, from the item&apos;s main price.
                {sample && ` The example uses "${sample.title}" at $${formatPrice(sample.priceCents)}.`}
              </p>
              {picked.map((s) => {
                const c = choiceFor(s);
                return (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-3 py-2">
                    <StoreLogo marketplace={s.marketplace} />
                    <span className="min-w-24 flex-1 font-medium">{s.label}</span>
                    <select
                      className="input w-auto"
                      aria-label={`Price on ${s.label}`}
                      value={c.mode}
                      onChange={(e) => setChoice(s.id, { ...c, mode: e.currentTarget.value as PriceMode })}
                    >
                      {hasRule(s.rule) && <option value="rule">Price rule ({describeRule(s.rule)})</option>}
                      <option value="match">Same as main price</option>
                      <option value="up">Raise by %</option>
                      <option value="down">Lower by %</option>
                    </select>
                    {(c.mode === "up" || c.mode === "down") && (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max={c.mode === "down" ? 90 : 500}
                          step="1"
                          inputMode="numeric"
                          className="input w-20"
                          aria-label={`Percent on ${s.label}`}
                          value={c.percent}
                          onChange={(e) => setChoice(s.id, { ...c, percent: e.currentTarget.value })}
                        />
                        %
                      </span>
                    )}
                    {sample && (
                      <span className="w-full text-xs text-zinc-500 sm:w-auto">
                        ${formatPrice(sample.priceCents)} → ${formatPrice(previewPrice(sample.priceCents, toChoice(c), s.rule))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">When should they go up?</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="publish" checked={publish} onChange={() => setPublish(true)} className="mt-0.5" />
                <span>
                  Publish now
                  <span className="block text-xs text-zinc-500">
                    Posts to {picked.map((s) => s.label).join(", ")} right away. Drafts are also posted to every other store
                    already ticked on them. Poshmark and the other extension stores wait in the Relistic extension for you to
                    press Post.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="publish" checked={!publish} onChange={() => setPublish(false)} className="mt-0.5" />
                <span>
                  Save as drafts
                  <span className="block text-xs text-zinc-500">
                    Ticks these stores with your prices and titles on each draft, so you can check them and post later.
                    {drafts < n && ` ${n - drafts} of the ${n} items are already listed, so they'll be skipped. Pick Publish now for those.`}
                  </span>
                </span>
              </label>
            </fieldset>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-6 py-4">
          {results ? (
            <button type="button" className="btn ml-auto" onClick={() => onClose(true)}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" disabled={running} onClick={() => (step ? setStep(step - 1) : onClose(false))}>
                {step ? "Back" : "Cancel"}
              </button>
              {step < 2 ? (
                <button type="button" className="btn" disabled={stores.size === 0} onClick={() => setStep(step + 1)}>
                  Next
                </button>
              ) : (
                <button type="button" className="btn" disabled={running || stores.size === 0} onClick={run}>
                  {running
                    ? `${publish ? "Listing" : "Saving"}… ${done} of ${n}`
                    : `${publish ? "Crosslist" : "Save"} ${n} ${n === 1 ? "item" : "items"}${publish ? "" : " as drafts"}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

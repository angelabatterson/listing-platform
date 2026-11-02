"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { crosslistItem } from "@/app/(app)/items/inventory-actions";
import { eachLimited } from "@/lib/photos/resize";

type Bulk = { picked: Set<string>; toggle: (id: string, on: boolean) => void; setAll: (on: boolean) => void; ids: string[] };
const BulkContext = createContext<Bulk | null>(null);

// Ticks on the Inventory rows, for listing many items on more stores at once.
export function BulkCrosslist(props: {
  items: { id: string; title: string }[];
  stores: { id: string; label: string }[];
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

function BulkBar(props: { items: { id: string; title: string }[]; stores: { id: string; label: string }[]; onDone: () => void }) {
  const bulk = useContext(BulkContext)!;
  const router = useRouter();
  const [stores, setStores] = useState<Set<string>>(() => new Set());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const chosen = props.items.filter((i) => bulk.picked.has(i.id));

  async function run() {
    setRunning(true);
    setDone(0);
    const out: Result[] = [];
    await eachLimited(chosen, 2, async (item) => {
      const r = await crosslistItem(item.id, [...stores]).catch((err: unknown) => ({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }));
      out.push({ title: item.title, ...r });
      setDone((n) => n + 1);
    });
    setRunning(false);
    setResults(out);
    router.refresh();
  }

  const failed = results?.filter((r) => !r.ok) ?? [];
  return (
    <div className="sticky bottom-0 z-20 mt-3 space-y-2 rounded-lg border border-zinc-300 bg-white p-3 text-sm shadow-lg">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">
          {chosen.length} {chosen.length === 1 ? "item" : "items"} selected
        </span>
        <span className="text-zinc-600">List on:</span>
        {props.stores.map((s) => (
          <label key={s.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={stores.has(s.id)}
              disabled={running}
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
            {s.label}
          </label>
        ))}
        <button type="button" className="btn" disabled={running || stores.size === 0} onClick={run}>
          {running ? `Listing… ${done} of ${chosen.length}` : `List ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`}
        </button>
        <button type="button" className="text-zinc-600 underline" disabled={running} onClick={props.onDone}>
          Clear
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Drafts are posted to every store ticked on them. Poshmark and the other extension stores wait in the Relistic
        extension for you to press Post.
      </p>
      {results && (
        <div>
          <p className={failed.length ? "text-amber-800" : "text-green-800"}>
            {results.length - failed.length} of {results.length} listed.
            {failed.length > 0 && " These need a fix:"}
          </p>
          {failed.length > 0 && (
            <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-amber-900">
              {failed.map((r, i) => (
                <li key={i}>
                  <strong>{r.title}:</strong> {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { discardDraft, postDraft, quickEdit } from "@/app/(app)/batches/actions";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { eachLimited } from "@/lib/photos/resize";

export type ReviewDraft = {
  id: string;
  sku: string;
  title: string;
  price: string;
  condition: string;
  thumbUrl: string | null;
  priceNote?: string;
  problems: string[];
};

type RowStatus = { kind: "posting" | "error" | "posted"; text?: string };

function DraftRow(props: {
  draft: ReviewDraft;
  selected: boolean;
  onSelect: (on: boolean) => void;
  status?: RowStatus;
  onSaved: (error?: string) => void;
  disabled: boolean;
}) {
  const d = props.draft;
  const [values, setValues] = useState({ title: d.title, price: d.price, condition: d.condition });
  const dirty = values.title !== d.title || values.price !== d.price || values.condition !== d.condition;

  async function save(next = values) {
    if (next.title === d.title && next.price === d.price && next.condition === d.condition) return;
    const result = await quickEdit(d.id, next);
    props.onSaved(result.error);
  }

  const ready = d.problems.length === 0 && !dirty;
  return (
    <li className="flex gap-4 py-4">
      <input
        type="checkbox"
        aria-label={`Post ${d.sku}`}
        className="mt-6"
        checked={props.selected && ready}
        disabled={!ready || props.disabled}
        onChange={(e) => props.onSelect(e.currentTarget.checked)}
      />
      {d.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed thumbnails, already small
        <img src={d.thumbUrl} alt="" className="h-20 w-20 flex-none rounded object-cover" />
      ) : (
        <div className="h-20 w-20 flex-none rounded bg-zinc-100" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Title"
            className="input min-w-0 flex-1"
            value={values.title}
            maxLength={140}
            disabled={props.disabled}
            onChange={(e) => setValues({ ...values, title: e.currentTarget.value })}
            onBlur={() => save()}
          />
          <span className={`text-xs ${values.title.length > 80 ? "text-amber-700" : "text-zinc-500"}`}>
            {values.title.length}/80
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs text-zinc-600">{d.sku}</span>
          <label className="flex items-center gap-1">
            $
            <input
              aria-label="Price"
              type="number"
              step="0.01"
              min="0.01"
              className="input w-24"
              value={values.price}
              disabled={props.disabled}
              onChange={(e) => setValues({ ...values, price: e.currentTarget.value })}
              onBlur={() => save()}
            />
          </label>
          <select
            aria-label="Condition"
            className="input w-auto"
            value={values.condition}
            disabled={props.disabled}
            onChange={(e) => {
              const next = { ...values, condition: e.currentTarget.value };
              setValues(next);
              save(next);
            }}
          >
            {EBAY_CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <Link href={`/items/${d.id}`} className="underline">Edit everything</Link>
          <form action={discardDraft.bind(null, d.id)}>
            <button className="text-zinc-600 underline" disabled={props.disabled}>Discard and redo</button>
          </form>
        </div>
        {d.priceNote && <p className="text-xs text-zinc-500">AI price note: {d.priceNote}</p>}
        {d.problems.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-amber-800">
            {d.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {props.status && (
          <p
            className={`text-sm ${
              props.status.kind === "error" ? "text-red-600" : props.status.kind === "posted" ? "text-green-700" : "text-zinc-600"
            }`}
          >
            {props.status.kind === "posting" ? "Posting…" : props.status.text}
          </p>
        )}
      </div>
    </li>
  );
}

// Check every draft in a batch on one screen, then post the ticked ones.
export function ReviewBoard(props: { batchId: string; drafts: ReviewDraft[] }) {
  const router = useRouter();
  // Every ready draft is ticked unless the seller unticks it.
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [posting, setPosting] = useState(false);
  const ready = props.drafts.filter((d) => d.problems.length === 0 && !unticked.has(d.id));

  const setStatus = (id: string, status: RowStatus) => setStatuses((s) => ({ ...s, [id]: status }));

  async function postSelected() {
    setPosting(true);
    await eachLimited(ready, 2, async (d) => {
      setStatus(d.id, { kind: "posting" });
      const result = await postDraft(d.id).catch((err: unknown) => ({
        error: err instanceof Error ? err.message : String(err),
        failed: undefined,
      }));
      if (result.error) setStatus(d.id, { kind: "error", text: result.error });
      else if (result.failed) setStatus(d.id, { kind: "error", text: `Posted with problems: ${result.failed.join(" ")}` });
      else setStatus(d.id, { kind: "posted", text: "Posted." });
    });
    setPosting(false);
    router.refresh();
  }

  return (
    <section className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Review drafts ({props.drafts.length})</h2>
          <p className="text-sm text-zinc-600">
            Fix anything the AI got wrong, then post the ticked drafts. Drafts with problems listed can&apos;t be ticked yet.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/batches/${props.batchId}/export`} className="btn-secondary">Download CSV</a>
          <button type="button" className="btn" disabled={posting || ready.length === 0} onClick={postSelected}>
            {posting ? "Posting…" : `Post ${ready.length} ${ready.length === 1 ? "listing" : "listings"}`}
          </button>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-zinc-100">
        {props.drafts.map((d) => (
          <DraftRow
            key={`${d.id}-${d.title}-${d.price}-${d.condition}`}
            draft={d}
            selected={!unticked.has(d.id)}
            disabled={posting}
            status={statuses[d.id]}
            onSelect={(on) =>
              setUnticked((s) => {
                const next = new Set(s);
                if (on) next.delete(d.id);
                else next.add(d.id);
                return next;
              })
            }
            onSaved={(error) => {
              if (error) return setStatus(d.id, { kind: "error", text: error });
              setStatuses((s) => {
                const next = { ...s };
                delete next[d.id];
                return next;
              });
              router.refresh();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

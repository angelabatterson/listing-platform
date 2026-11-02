"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelSchedule, discardDraft, postDraft, quickEdit, scheduleDrafts, setDraftStore } from "@/app/(app)/batches/actions";
import { EBAY_CONDITIONS } from "@/lib/marketplaces/ebay/mapping";
import { eachLimited } from "@/lib/photos/resize";
import { scheduleTimes, type SchedulePlan } from "@/lib/schedule";
import { LocalTime } from "./local-time";
import { PhotoViewer } from "./photo-viewer";

export type ReviewDraft = {
  id: string;
  sku: string;
  title: string;
  price: string;
  condition: string;
  thumbUrl: string | null;
  // Every photo on the item, full size, in order.
  photoUrls: string[];
  priceNote?: string;
  skuNote?: string;
  // Every store the seller has, and whether this draft will post to it.
  stores: { connectionId: string; label: string; enabled: boolean; ready: boolean }[];
  problems: string[];
  // When it's set to post by itself (ISO time), or null.
  scheduledAt: string | null;
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
  const saved = { title: d.title, price: d.price, condition: d.condition, sku: d.sku };
  const [values, setValues] = useState(saved);
  const [zoom, setZoom] = useState<number | null>(null);
  const [storeBusy, setStoreBusy] = useState(false);
  const same = (a: typeof saved) => (Object.keys(saved) as (keyof typeof saved)[]).every((k) => a[k] === saved[k]);
  const dirty = !same(values);

  async function save(next = values) {
    if (same(next)) return;
    const result = await quickEdit(d.id, next);
    props.onSaved(result.error);
  }

  async function toggleStore(connectionId: string, on: boolean) {
    setStoreBusy(true);
    const result = await setDraftStore(d.id, connectionId, on);
    setStoreBusy(false);
    props.onSaved(result.error);
  }

  const ready = d.problems.length === 0 && !dirty && !d.scheduledAt;
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
      {d.thumbUrl && d.photoUrls.length > 0 ? (
        <button type="button" className="flex flex-none flex-col items-center gap-1 text-xs text-zinc-600" onClick={() => setZoom(0)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed thumbnails, already small */}
          <img src={d.thumbUrl} alt="" className="h-20 w-20 rounded object-cover" />
          <span className="underline">
            See {d.photoUrls.length === 1 ? "photo" : `all ${d.photoUrls.length} photos`}
          </span>
        </button>
      ) : (
        <div className="h-20 w-20 flex-none rounded bg-zinc-100" />
      )}
      {zoom !== null && (
        <PhotoViewer urls={d.photoUrls} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />
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
          <label className="flex items-center gap-1 text-xs text-zinc-600">
            SKU
            <input
              aria-label="SKU"
              className="input w-28 font-mono text-xs"
              value={values.sku}
              maxLength={50}
              disabled={props.disabled}
              onChange={(e) => setValues({ ...values, sku: e.currentTarget.value })}
              onBlur={() => save()}
            />
          </label>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-medium">Post to:</span>
          {d.stores.length === 0 && (
            <Link href="/stores" className="underline">Connect a store first</Link>
          )}
          {d.stores.map((st) => (
            <label key={st.connectionId} className={`flex items-center gap-1 ${st.ready ? "" : "text-zinc-400"}`}>
              <input
                type="checkbox"
                checked={st.enabled}
                disabled={props.disabled || storeBusy || (!st.ready && !st.enabled)}
                onChange={(e) => toggleStore(st.connectionId, e.currentTarget.checked)}
              />
              {st.label}
              {!st.ready && (
                <Link href="/stores" className="text-xs underline">(finish setup)</Link>
              )}
            </label>
          ))}
        </div>
        {d.scheduledAt && <ScheduledNote itemId={d.id} at={d.scheduledAt} onDone={props.onSaved} disabled={props.disabled} />}
        {d.priceNote && <p className="text-xs text-zinc-500">AI price note: {d.priceNote}</p>}
        {d.skuNote && <p className="text-xs text-amber-800">{d.skuNote}</p>}
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

export function ScheduledNote(props: { itemId: string; at: string; onDone: (error?: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <p className="text-sm text-blue-800">
      Scheduled to post <LocalTime iso={props.at} />.{" "}
      <button
        type="button"
        className="underline disabled:opacity-50"
        disabled={busy || props.disabled}
        onClick={async () => {
          setBusy(true);
          const result = await cancelSchedule(props.itemId);
          setBusy(false);
          props.onDone(result.error);
        }}
      >
        Cancel schedule
      </button>
    </p>
  );
}

// The next whole hour, as a datetime-local value in the browser's time zone.
function nextHour(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => (h === 0 || h === 24 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`);

function SchedulePanel(props: { count: number; busy: boolean; onSchedule: (plan: SchedulePlan) => void; onClose: () => void }) {
  const [start, setStart] = useState(nextHour);
  const [mode, setMode] = useState<SchedulePlan["mode"]>("spread");
  const [perDay, setPerDay] = useState("5");
  const [fromHour, setFromHour] = useState(9);
  const [toHour, setToHour] = useState(21);
  const plan: SchedulePlan = { start: new Date(start), mode, perDay: Number(perDay) || 1, fromHour, toHour };
  const valid = !Number.isNaN(plan.start.getTime()) && (mode === "once" || (plan.perDay >= 1 && toHour > fromHour));
  const times = valid ? scheduleTimes(props.count, plan) : [];
  const last = times[times.length - 1];
  return (
    <div className="mb-3 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-zinc-700">Start</span>
          <input type="datetime-local" className="input mt-1" value={start} onChange={(e) => setStart(e.currentTarget.value)} />
        </label>
        <fieldset className="flex gap-4">
          <legend className="sr-only">How to post</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === "once"} onChange={() => setMode("once")} /> All at once
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === "spread"} onChange={() => setMode("spread")} /> Spread out
          </label>
        </fieldset>
      </div>
      {mode === "spread" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={200}
            className="input w-20"
            aria-label="Listings per day"
            value={perDay}
            onChange={(e) => setPerDay(e.currentTarget.value)}
          />
          <span>a day, between</span>
          <select className="input w-auto" aria-label="From" value={fromHour} onChange={(e) => setFromHour(Number(e.currentTarget.value))}>
            {HOURS.slice(0, 24).map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
          <span>and</span>
          <select className="input w-auto" aria-label="Until" value={toHour} onChange={(e) => setToHour(Number(e.currentTarget.value))}>
            {HOURS.slice(1).map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>
      )}
      <p className="text-zinc-600">
        {!valid
          ? "Pick a start time, and an end hour after the start hour."
          : mode === "once" || props.count === 1
            ? `${props.count === 1 ? "It goes" : `All ${props.count} go`} up ${times[0]?.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) ?? ""}.`
            : `${props.count} listings, the first ${times[0].toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} and the last ${last.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`}{" "}
        Relistic posts them by itself, even with this page closed. Poshmark and other extension stores get a reminder in
        the Relistic extension instead.
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn" disabled={!valid || props.busy || props.count === 0} onClick={() => props.onSchedule(plan)}>
          {props.busy ? "Scheduling…" : `Schedule ${props.count} ${props.count === 1 ? "listing" : "listings"}`}
        </button>
        <button type="button" className="btn-secondary" onClick={props.onClose}>Close</button>
      </div>
    </div>
  );
}

// Check every draft in a batch on one screen, then post the ticked ones.
export function ReviewBoard(props: { batchId: string; drafts: ReviewDraft[] }) {
  const router = useRouter();
  // Every ready draft is ticked unless the seller unticks it.
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [posting, setPosting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<{ error?: boolean; text: string; problems?: string[] } | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const ready = props.drafts.filter((d) => d.problems.length === 0 && !d.scheduledAt && !unticked.has(d.id));
  const scheduledCount = props.drafts.filter((d) => d.scheduledAt).length;

  async function scheduleSelected(plan: SchedulePlan) {
    setScheduling(true);
    const times = scheduleTimes(ready.length, plan);
    const result = await scheduleDrafts(ready.map((d, i) => ({ itemId: d.id, at: times[i].toISOString() }))).catch((err: unknown) => ({
      error: err instanceof Error ? err.message : String(err),
      scheduled: undefined,
      problems: undefined,
    }));
    setScheduling(false);
    if (result.error) setScheduleMessage({ error: true, text: result.error });
    else {
      setScheduleMessage({
        text: `Scheduled ${result.scheduled} ${result.scheduled === 1 ? "listing" : "listings"}.`,
        problems: result.problems,
      });
      setShowSchedule(false);
    }
    router.refresh();
  }

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
            Fix anything the AI got wrong, then post the ticked drafts now or schedule them for later. Drafts with problems
            listed can&apos;t be ticked yet.
            {scheduledCount > 0 && ` ${scheduledCount} ${scheduledCount === 1 ? "is" : "are"} already scheduled.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/batches/${props.batchId}/export`} className="btn-secondary">Download CSV</a>
          <button
            type="button"
            className="btn-secondary"
            disabled={posting || ready.length === 0}
            onClick={() => {
              setShowSchedule((v) => !v);
              setScheduleMessage(null);
            }}
          >
            Schedule…
          </button>
          <button type="button" className="btn" disabled={posting || ready.length === 0} onClick={postSelected}>
            {posting ? "Posting…" : `Post ${ready.length} ${ready.length === 1 ? "listing" : "listings"}`}
          </button>
        </div>
      </div>
      {showSchedule && (
        <SchedulePanel count={ready.length} busy={scheduling} onSchedule={scheduleSelected} onClose={() => setShowSchedule(false)} />
      )}
      {scheduleMessage && (
        <div className={`mb-3 text-sm ${scheduleMessage.error ? "text-red-700" : "text-green-800"}`}>
          <p>{scheduleMessage.text}</p>
          {scheduleMessage.problems && (
            <ul className="list-disc pl-5 text-amber-800">
              {scheduleMessage.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ul className="flex flex-col divide-y divide-zinc-100">
        {props.drafts.map((d) => (
          <DraftRow
            key={`${d.id}-${d.title}-${d.price}-${d.condition}-${d.sku}-${d.scheduledAt}`}
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

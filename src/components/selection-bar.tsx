"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { addTagsToSelected, deleteSelected, delistSelected, syncSelected, type RowResult } from "@/app/(app)/items/bulk-actions";
import { eachLimited } from "@/lib/photos/resize";
import { CrosslistDialog, type BulkItem, type BulkStore } from "./bulk-crosslist";

// Outline icons (24px grid), drawn with the text colour.
const ICONS = {
  edit: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4",
  sync: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  crosslist: "M4 8h13l-3-3M20 16H7l3 3",
  tag: "M3 12V4h8l9 9-8 8-9-9Zm5-4.5a1 1 0 1 0 0 .01",
  delist: "M5 12h14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path d={ICONS[name]} />
    </svg>
  );
}

const barButton =
  "inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 disabled:opacity-40";

type Action = "sync" | "delist" | "delete";
type Result = { title: string } & RowResult;

const plural = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

// The dark bar at the bottom of Inventory while items are ticked, like a toolbar for
// the ticked items.
export function SelectionBar(props: { items: BulkItem[]; stores: BulkStore[]; onClear: () => void }) {
  const [open, setOpen] = useState<Action | "crosslist" | "tags" | null>(null);
  const n = props.items.length;
  const one = n === 1 ? props.items[0] : null;
  const finish = (done: boolean) => {
    setOpen(null);
    if (done) props.onClear();
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Actions for the ticked items"
        className="sticky bottom-16 z-30 mx-auto mt-3 w-fit max-w-full rounded-xl bg-zinc-900 p-3 text-white shadow-2xl sm:bottom-4"
      >
        <div className="mb-2 flex items-center gap-2 text-sm">
          <button type="button" onClick={props.onClear} aria-label="Untick all" className="rounded-full p-1 hover:bg-white/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          <span className="font-medium">{plural(n)} selected</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {one ? (
            <Link href={`/items/${one.id}`} className={barButton}>
              <Icon name="edit" /> Edit
            </Link>
          ) : (
            <button type="button" className={barButton} disabled title="Tick one item to edit it">
              <Icon name="edit" /> Edit
            </button>
          )}
          <button type="button" className={barButton} onClick={() => setOpen("sync")}>
            <Icon name="sync" /> Sync now
          </button>
          <button
            type="button"
            className={barButton}
            onClick={() => setOpen("crosslist")}
            disabled={!props.stores.length}
            title={props.stores.length ? undefined : "Connect a store first, on the Stores page"}
          >
            <Icon name="crosslist" /> Crosslist
          </button>
          <button type="button" className={barButton} onClick={() => setOpen("tags")}>
            <Icon name="tag" /> Add tags
          </button>
          <button type="button" className={barButton} onClick={() => setOpen("delist")}>
            <Icon name="delist" /> Delist
          </button>
          <button type="button" className={`${barButton} hover:bg-red-600`} onClick={() => setOpen("delete")}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </div>
      {open === "crosslist" && <CrosslistDialog items={props.items} stores={props.stores} onClose={finish} />}
      {open === "tags" && <TagsDialog items={props.items} onClose={finish} />}
      {(open === "sync" || open === "delist" || open === "delete") && (
        <ActionDialog action={open} items={props.items} onClose={finish} />
      )}
    </>
  );
}

const ACTIONS: Record<
  Action,
  { title: (n: number) => string; run: (id: string) => Promise<RowResult>; button: string; busy: string; done: string; danger?: boolean }
> = {
  sync: {
    title: (n) => `Sync ${plural(n)} now`,
    run: syncSelected,
    button: "Sync now",
    busy: "Syncing",
    done: "synced",
  },
  delist: {
    title: (n) => `Delist ${plural(n)}`,
    run: delistSelected,
    button: "Delist",
    busy: "Delisting",
    done: "taken off their stores",
  },
  delete: {
    title: (n) => `Delete ${plural(n)}`,
    run: deleteSelected,
    button: "Delete",
    busy: "Deleting",
    done: "deleted",
    danger: true,
  },
};

function Explanation({ action, items }: { action: Action; items: BulkItem[] }) {
  const sold = items.filter((i) => i.sold).length;
  if (action === "sync") {
    return <p>Relistic sends each item&apos;s current title, price, photos and quantity to every store it&apos;s on.</p>;
  }
  if (action === "delist") {
    return (
      <>
        <p>Relistic takes {items.length === 1 ? "this item" : "these items"} off every store and keeps them in your Inventory, under the Delisted tab. You can list them again any time with Crosslist.</p>
        <p className="text-zinc-500">Poshmark, Depop, Mercari, Grailed, Facebook Marketplace and Whatnot are taken down through the Chrome extension, which asks you to confirm.</p>
      </>
    );
  }
  return (
    <>
      <p>
        Relistic takes {items.length === 1 ? "this item" : "these items"} off every store, then deletes{" "}
        {items.length === 1 ? "it" : "them"} and {items.length === 1 ? "its" : "their"} photos for good. <strong>This can&apos;t be undone.</strong>
      </p>
      <p className="text-zinc-500">
        Items that have sold can&apos;t be deleted, because your sales records need them.
        {sold > 0 && ` ${sold} of the ticked items ${sold === 1 ? "has" : "have"} sold and will be skipped.`} An item still up on a Chrome extension
        store is skipped too until you delist it there.
      </p>
    </>
  );
}

// Confirm, then run one action on every ticked item and show how each went.
function ActionDialog(props: { action: Action; items: BulkItem[]; onClose: (done: boolean) => void }) {
  const router = useRouter();
  const a = ACTIONS[props.action];
  // The ticked items when the pop-up opened (deleted ones drop out of the list behind it).
  const [items] = useState(props.items);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const { onClose } = props;
  const close = () => !running && onClose(Boolean(results));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !running && onClose(Boolean(results));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running, results]);

  async function run() {
    setRunning(true);
    const out: Result[] = [];
    await eachLimited(items, 2, async (item) => {
      const r =
        props.action === "delete" && item.sold
          ? { ok: false, message: "It has sold, so it can't be deleted." }
          : await a.run(item.id).catch(() => ({ ok: false, message: "Something went wrong. Try again." }));
      out.push({ title: item.title, ...r });
      setDone((d) => d + 1);
    });
    setRunning(false);
    setResults(out);
    router.refresh();
  }

  const failed = results?.filter((r) => !r.ok) ?? [];
  const n = items.length;
  return (
    <Dialog title={a.title(n)} onClose={close} running={running}>
      <div className="space-y-3 px-6 py-5">
        {results ? (
          <>
            <p className={failed.length ? "text-amber-800" : "text-green-800"}>
              {results.length - failed.length} of {results.length} {a.done}.{failed.length > 0 && " These weren't:"}
            </p>
            {failed.length > 0 && (
              <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-amber-900">
                {failed.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium">{r.title}</span>: {r.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Explanation action={props.action} items={items} />
        )}
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4">
        {results ? (
          <button type="button" className="btn" onClick={() => onClose(true)}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" disabled={running} onClick={() => onClose(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={a.danger ? "btn border-red-700 bg-red-700 hover:bg-red-800" : "btn"}
              disabled={running}
              onClick={run}
            >
              {running ? `${a.busy}… ${done} of ${n}` : `${a.button} ${plural(n)}`}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

function TagsDialog(props: { items: BulkItem[]; onClose: (done: boolean) => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await addTagsToSelected(
      props.items.map((i) => i.id),
      text,
    ).catch(() => ({ error: "Something went wrong. Try again.", message: undefined }));
    setSaving(false);
    if (r.error) return setError(r.error);
    setMessage(r.message ?? "Tags added.");
    router.refresh();
  }

  return (
    <Dialog title={`Add tags to ${plural(props.items.length)}`} onClose={() => !saving && props.onClose(Boolean(message))} running={saving}>
      {message ? (
        <>
          <p className="px-6 py-5 text-green-800">{message}</p>
          <div className="flex justify-end border-t border-zinc-200 px-6 py-4">
            <button type="button" className="btn" onClick={() => props.onClose(true)}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          <div className="space-y-2 px-6 py-5">
            <label htmlFor="bulk-tags" className="block font-medium">
              Tags
            </label>
            <input
              id="bulk-tags"
              className="input w-full"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Bin 4, women's denim"
              autoFocus
            />
            <p className="text-xs text-zinc-500">Separate tags with commas. Tags the items already have are kept.</p>
            {error && <p className="text-red-700">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t border-zinc-200 px-6 py-4">
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => props.onClose(false)}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={saving || !text.trim()}>
              {saving ? "Adding…" : "Add tags"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function Dialog(props: { title: string; onClose: () => void; running: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={props.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="w-full max-w-lg rounded-lg bg-white text-sm text-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold">{props.title}</h2>
          <button type="button" onClick={props.onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100" disabled={props.running}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

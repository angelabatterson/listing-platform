"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportStep } from "@/app/(app)/stores/actions";
import type { ImportCounts } from "@/lib/import";

const zero: ImportCounts = { created: 0, matched: 0, already: 0, unsupported: 0, overLimit: 0 };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Import my listings": brings a store's live listings into Inventory, page by page.
export function ImportListings(props: {
  store: string;
  imported: number;
  note?: string;
  run: (page: number) => Promise<ImportStep>;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  async function start() {
    setRunning(true);
    setFinished(false);
    setError(null);
    let sum = { ...zero };
    setCounts(sum);
    for (let page = 1; ; page++) {
      const step = await props.run(page).catch(() => ({ error: "Lost the connection. Press Import again to carry on." }) as ImportStep);
      if (step.error || !step.counts) {
        setError(step.error ?? "Something went wrong. Press Import again to carry on.");
        break;
      }
      const c = step.counts;
      sum = {
        created: sum.created + c.created,
        matched: sum.matched + c.matched,
        already: sum.already + c.already,
        unsupported: sum.unsupported + c.unsupported,
        overLimit: sum.overLimit + c.overLimit,
      };
      setCounts(sum);
      setTotal(step.total ?? 0);
      if (step.done) {
        setFinished(true);
        break;
      }
    }
    setRunning(false);
    router.refresh();
  }

  const seen = counts ? counts.created + counts.matched + counts.already + counts.unsupported + counts.overLimit : 0;

  return (
    <div className="mt-5 space-y-3 border-t border-zinc-100 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Import your {props.store} listings</h3>
          <p className="text-sm text-zinc-600">
            Brings the listings already live on {props.store} into your Inventory, so they sync with your other stores.
            Items you already have in Relistic (same SKU or same title) are linked, not copied.
            {props.imported > 0 && ` ${plural(props.imported, "listing")} imported so far.`}
          </p>
          {props.note && <p className="mt-1 text-sm text-zinc-500">{props.note}</p>}
        </div>
        <button type="button" className="btn" onClick={start} disabled={running}>
          {running ? "Importing…" : props.imported > 0 ? "Import again" : "Import my listings"}
        </button>
      </div>

      {counts && (
        <div className="rounded-md bg-zinc-50 px-4 py-3 text-sm text-zinc-700" aria-live="polite">
          {running && <p>Checked {seen}{total ? ` of ${total}` : ""} listings. Keep this page open.</p>}
          {finished && <p className="font-medium text-green-800">Done. Checked {plural(seen, "listing")}.</p>}
          <ul className="mt-1 list-disc pl-5">
            {counts.created > 0 && <li>{plural(counts.created, "new item")} added to Inventory</li>}
            {counts.matched > 0 && <li>{plural(counts.matched, "listing")} linked to items you already had</li>}
            {counts.already > 0 && <li>{plural(counts.already, "listing")} already imported before</li>}
            {counts.unsupported > 0 && (
              <li>{plural(counts.unsupported, "listing")} with variations (like several sizes) skipped for now</li>
            )}
            {counts.overLimit > 0 && (
              <li className="text-amber-800">
                {plural(counts.overLimit, "listing")} not imported because your plan&apos;s listing limit was reached.{" "}
                <Link href="/billing" className="underline">
                  Change plan
                </Link>
              </li>
            )}
          </ul>
          {finished && (counts.created > 0 || counts.matched > 0) && (
            <p className="mt-2">
              <Link href="/items" className="underline">
                See them in Inventory
              </Link>
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelSchedule } from "@/app/(app)/batches/actions";
import { discardFailed, retryFailed, saveRowDetails, setFavorite } from "@/app/(app)/items/inventory-actions";
import { LocalTime } from "./local-time";

// The favorite star at the start of an Inventory row.
export function FavoriteStar(props: { itemId: string; favorite: boolean }) {
  const [on, setOn] = useState(props.favorite);
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      disabled={pending}
      className={`text-lg leading-none ${on ? "text-amber-500" : "text-zinc-300 hover:text-zinc-500"}`}
      onClick={() => {
        const next = !on;
        setOn(next);
        startTransition(async () => {
          const result = await setFavorite(props.itemId, next);
          if (result.error) setOn(!next);
        });
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

// A small box in the row that saves when you click away (or press Enter).
export function RowField(props: {
  itemId: string;
  field: "notes" | "cost";
  value: string;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const [value, setValue] = useState(props.value);
  const [saved, setSaved] = useState(props.value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (value === saved) return;
    startTransition(async () => {
      const result = await saveRowDetails(props.itemId, { [props.field]: value });
      if (result.error) setError(result.error);
      else {
        setError(null);
        setSaved(value);
      }
    });
  }

  return (
    <span className="flex flex-col">
      <input
        aria-label={props.label}
        value={value}
        placeholder={props.placeholder}
        maxLength={props.field === "notes" ? 500 : 12}
        inputMode={props.field === "cost" ? "decimal" : undefined}
        className={`rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-zinc-200 focus:border-zinc-400 focus:bg-white focus:outline-none ${
          pending ? "opacity-60" : ""
        } ${props.className ?? ""}`}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(saved);
            setError(null);
          }
        }}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

// "Some listings failed to post" with Retry and Discard, above the Inventory list.
export function FailedBanner(props: { count: number; href: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ message?: string; error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
      <span>
        {props.count === 1 ? "1 listing failed to post or update." : `${props.count} listings failed to post or update.`}{" "}
        <a href={props.href} className="underline">See which</a>
        {message && <span className="ml-2 text-zinc-700">{message}</span>}
      </span>
      <span className="flex gap-2">
        <button type="button" className="btn-secondary py-1" disabled={pending} onClick={() => run(retryFailed)}>
          {pending ? "Working…" : "Retry"}
        </button>
        <button
          type="button"
          className="btn-secondary py-1"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Clear these problems? Listings that never went up are unticked for that store; live listings stay up.")) {
              run(discardFailed);
            }
          }}
        >
          Discard
        </button>
      </span>
    </div>
  );
}

// "Posts Tue, Nov 4, 9:00 AM" on a scheduled draft, with a way to cancel.
export function ScheduledBadge(props: { itemId: string; at: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-800">
      Posts <LocalTime iso={props.at} />
      <button
        type="button"
        disabled={pending}
        className="underline disabled:opacity-50"
        onClick={() =>
          startTransition(async () => {
            await cancelSchedule(props.itemId);
            router.refresh();
          })
        }
      >
        Cancel
      </button>
    </span>
  );
}

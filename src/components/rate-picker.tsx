"use client";

import { useActionState, useId, useState } from "react";
import { useFormAction } from "./use-form-action";
import type { BuyState, RatesState } from "@/app/(app)/shipping/actions";
import type { Rate } from "@/lib/shipping/shippo";
import type { ParcelSize } from "@/db/schema";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function BuyButton(props: { rate: Rate; buy: (rateId: string) => Promise<BuyState> }) {
  const [state, dispatch, pending] = useActionState(() => props.buy(props.rate.id), undefined);
  return (
    <form action={dispatch} className="flex flex-col items-end gap-1">
      <button className="btn" disabled={pending}>{pending ? "Buying…" : `Buy for ${money(props.rate.costCents)}`}</button>
      {state?.error && <p className="max-w-xs text-right text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

// Weigh the parcel, compare carriers, and buy one label.
export function RatePicker(props: {
  parcel: ParcelSize | null;
  quote: (state: RatesState, formData: FormData) => Promise<RatesState>;
  buy: (rateId: string) => Promise<BuyState>;
}) {
  const { state, onSubmit, pending } = useFormAction(props.quote);
  const uid = useId();
  const p = props.parcel;
  const [showAll, setShowAll] = useState(false);
  const field = (name: string, label: string, value: string) => (
    <div>
      <label htmlFor={`${uid}-${name}`} className="label">{label}</label>
      <input id={`${uid}-${name}`} name={name} type="number" step="any" min="0" className="input" defaultValue={value} />
    </div>
  );
  const rates = state?.rates ?? [];
  const shown = showAll ? rates : rates.slice(0, 6);
  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="card space-y-4">
        <h2 className="text-lg font-semibold">Parcel</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {field("lengthIn", "Length (in)", p ? String(p.lengthIn) : "10")}
          {field("widthIn", "Width (in)", p ? String(p.widthIn) : "8")}
          {field("heightIn", "Height (in)", p ? String(p.heightIn) : "4")}
          {field("pounds", "Pounds", p ? String(Math.floor(p.weightOz / 16)) : "1")}
          {field("ounces", "Ounces", p ? String(Math.round((p.weightOz % 16) * 10) / 10) : "0")}
        </div>
        <p className="text-xs text-zinc-500">Weigh it packed. Carriers charge extra if the weight on the label is too low.</p>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn" disabled={pending}>{pending ? "Getting prices…" : rates.length ? "Update prices" : "Get prices"}</button>
      </form>

      {rates.length > 0 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Choose a service</h2>
          <ul className="divide-y divide-zinc-100">
            {shown.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-medium">
                    {r.carrier} {r.service}
                    {i === 0 && <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Cheapest</span>}
                  </div>
                  {r.days !== null && (
                    <div className="text-sm text-zinc-500">About {r.days} {r.days === 1 ? "day" : "days"}</div>
                  )}
                </div>
                <BuyButton rate={r} buy={props.buy} />
              </li>
            ))}
          </ul>
          {rates.length > shown.length && (
            <button type="button" className="text-sm underline" onClick={() => setShowAll(true)}>
              Show all {rates.length} services
            </button>
          )}
        </div>
      )}
    </div>
  );
}

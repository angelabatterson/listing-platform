"use client";

import { useState } from "react";
import { savePriceRules } from "@/app/(app)/stores/actions";
import { applyPriceRule, ROUNDING, type PriceRule } from "@/lib/price-rules";
import { useFormAction } from "./use-form-action";

type Store = { id: string; label: string; rule: PriceRule };

const EXAMPLE_CENTS = 4000;

function RuleRow(props: { store: Store }) {
  const [percent, setPercent] = useState(props.store.rule.percent ? String(props.store.rule.percent) : "");
  const [round, setRound] = useState<PriceRule["round"]>(props.store.rule.round);
  const example = applyPriceRule(EXAMPLE_CENTS, { percent: Number(percent) || 0, round });
  const id = props.store.id;
  return (
    <tr className="border-t border-zinc-100">
      <td className="py-2 pr-4 font-medium">{props.store.label}</td>
      <td className="py-2 pr-4">
        <span className="flex items-center gap-1">
          <input
            name={`percent_${id}`}
            aria-label={`Percent for ${props.store.label}`}
            inputMode="decimal"
            className="input w-20"
            placeholder="0"
            value={percent}
            onChange={(e) => setPercent(e.currentTarget.value)}
          />
          %
        </span>
      </td>
      <td className="py-2 pr-4">
        <select
          name={`round_${id}`}
          aria-label={`Rounding for ${props.store.label}`}
          className="input w-auto"
          value={round}
          onChange={(e) => setRound(e.currentTarget.value as PriceRule["round"])}
        >
          {Object.entries(ROUNDING).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </td>
      <td className="py-2 text-zinc-600 tabular-nums">${(example / 100).toFixed(2)}</td>
    </tr>
  );
}

// Each store's price set from the main price, e.g. Poshmark 10% higher to cover its fee.
export function PriceRulesForm(props: { stores: Store[] }) {
  const { state, onSubmit, pending } = useFormAction(savePriceRules);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Price rules</h2>
        <p className="text-sm text-zinc-600">
          Set each store&apos;s price from your main price, for example 10% higher on Poshmark to cover its fee. Use a
          minus sign to go lower, like -5. A price you type for one item on one store always wins. Changes show the
          next time an item is posted or synced.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead className="text-left text-zinc-600">
            <tr>
              <th className="py-1 pr-4 font-medium">Store</th>
              <th className="py-1 pr-4 font-medium">Raise or lower by</th>
              <th className="py-1 pr-4 font-medium">Rounding</th>
              <th className="py-1 font-medium">A $40.00 item becomes</th>
            </tr>
          </thead>
          <tbody>
            {props.stores.map((s) => (
              <RuleRow key={s.id} store={s} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save price rules"}</button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.saved && !pending && <p className="text-sm text-green-700">Saved.</p>}
      </div>
    </form>
  );
}

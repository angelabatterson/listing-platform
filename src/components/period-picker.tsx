"use client";

import { useState } from "react";
import { PERIODS, type Period } from "@/lib/periods";

// Time period for a filter form: presets, or two dates when "Custom dates" is chosen.
// Picking a preset submits the form by itself (see FilterForm); custom dates use Search.
export function PeriodPicker(props: { period: Period; from: string; to: string }) {
  const [period, setPeriod] = useState<Period>(props.period);
  return (
    <>
      <select
        name="period"
        value={period}
        onChange={(e) => setPeriod(e.target.value as Period)}
        className="input w-auto"
        aria-label="Time period"
      >
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <option key={p} value={p}>{PERIODS[p]}</option>
        ))}
      </select>
      {period === "custom" && (
        <span className="flex items-center gap-1">
          <input type="date" name="from" defaultValue={props.from} className="input w-auto" aria-label="From" />
          <span className="text-zinc-500">to</span>
          <input type="date" name="to" defaultValue={props.to} className="input w-auto" aria-label="To" />
        </span>
      )}
    </>
  );
}

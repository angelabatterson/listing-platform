"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addSale, deleteManualSale, importSales, saveSaleMoney } from "@/app/(app)/sales/actions";
import type { MoneyField } from "@/lib/sale-fields";
import { useFormAction } from "./use-form-action";

// One money box in a sale's row. Saves when you click away or press Enter; the page then
// works the profit out again.
export function MoneyBox(props: { saleId: string; field: MoneyField; value: string; label: string; estimated?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(props.value);
  const [saved, setSaved] = useState(props.value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (value.trim() === saved) return;
    startTransition(async () => {
      const result = await saveSaleMoney(props.saleId, props.field, value);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setSaved(value.trim());
        router.refresh();
      }
    });
  }

  return (
    <span className="flex flex-col items-end">
      <span className="flex items-center">
        <span className="text-zinc-400">$</span>
        <input
          aria-label={props.label}
          title={props.estimated ? "Estimated from the store's standard rates. Type the real amount to replace it." : undefined}
          value={value}
          placeholder="0.00"
          inputMode="decimal"
          maxLength={12}
          className={`w-[4.5rem] rounded border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums hover:border-zinc-200 focus:border-zinc-400 focus:bg-white focus:outline-none ${
            pending ? "opacity-60" : ""
          } ${props.estimated ? "italic text-zinc-500" : ""}`}
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
      </span>
      {error && <span className="max-w-32 text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function DeleteSaleButton(props: { saleId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-red-700 hover:underline disabled:opacity-50"
      onClick={() => {
        if (!confirm("Delete this sale you added? Stock isn't put back.")) return;
        startTransition(async () => {
          const result = await deleteManualSale(props.saleId);
          if (result.error) alert(result.error);
          router.refresh();
        });
      }}
    >
      Delete
    </button>
  );
}

function Outcome(props: { state?: { error?: string; message?: string; problems?: string[] } }) {
  const s = props.state;
  if (!s) return null;
  return (
    <div className="space-y-1 text-sm">
      {s.error && <p className="text-red-700">{s.error}</p>}
      {s.message && <p className="text-green-800">{s.message}</p>}
      {s.problems && s.problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-red-700">
          {s.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImportSalesForm() {
  const { state, onSubmit, pending } = useFormAction(importSales);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-zinc-600">
        Download your sales, change any amounts in Excel or Google Sheets, save it as CSV, and upload it here. Rows
        without a Sale ID are added as new sales (they need Store, Date and Title). Uploading the same file twice
        doesn&apos;t add anything twice.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,text/csv" aria-label="Sales CSV file" className="text-sm" />
        <button className="btn" disabled={pending}>{pending ? "Uploading…" : "Upload"}</button>
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function AddSaleForm(props: { stores: { id: string; label: string }[]; today: string }) {
  const { state, onSubmit, pending } = useFormAction(addSale);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-zinc-600">For a sale Relistic didn&apos;t see, like one in person or on a store that isn&apos;t connected.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="text-zinc-700">Store</span>
          <select name="connectionId" className="input mt-1" defaultValue="">
            <option value="" disabled>Pick a store</option>
            {props.stores.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">Date sold</span>
          <input type="date" name="date" defaultValue={props.today} className="input mt-1" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">SKU (to link the item)</span>
          <input name="sku" className="input mt-1" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">Title</span>
          <input name="title" className="input mt-1" placeholder="Filled from the item if blank" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">Quantity</span>
          <input name="quantity" type="number" min={1} defaultValue={1} className="input mt-1" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">Price ($)</span>
          <input name="price" inputMode="decimal" className="input mt-1" placeholder="0.00" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">Shipping charged ($)</span>
          <input name="shipping" inputMode="decimal" className="input mt-1" placeholder="0.00" />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-700">Store fees ($)</span>
          <input name="fees" inputMode="decimal" className="input mt-1" placeholder="0.00" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="lowerStock" />
        Take it out of stock (lowers the item&apos;s quantity and updates your other stores)
      </label>
      <button className="btn" disabled={pending}>{pending ? "Adding…" : "Add sale"}</button>
      <Outcome state={state} />
    </form>
  );
}

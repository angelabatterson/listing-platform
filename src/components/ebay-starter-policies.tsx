"use client";

import { useFormAction } from "./use-form-action";
import type { StoreSettingsState } from "@/app/(app)/stores/actions";

// For sellers with no eBay business policies yet: Relistic makes simple ones.
export function EbayStarterPolicies(props: {
  action: (state: StoreSettingsState, formData: FormData) => Promise<StoreSettingsState>;
  policiesUrl?: string;
}) {
  const { state, onSubmit, pending } = useFormAction(props.action);
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 rounded-md bg-amber-50 p-4">
      <p className="text-sm text-amber-900">
        eBay needs a shipping, payment and return policy on your account before anything can be listed. Relistic can
        make simple ones for you now.
        {props.policiesUrl && (
          <>
            {" "}
            You can change them later in{" "}
            <a href={props.policiesUrl} target="_blank" rel="noreferrer" className="underline">
              eBay&apos;s business policies
            </a>
            .
          </>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="shipping">Shipping charge (USD)</label>
          <input id="shipping" name="shipping" type="number" min="0" step="0.01" defaultValue="0" className="input" />
          <p className="mt-1 text-xs text-zinc-500">0 means free shipping. Sent by USPS Ground Advantage.</p>
        </div>
        <div>
          <label className="label" htmlFor="handlingDays">Ships within</label>
          <select id="handlingDays" name="handlingDays" defaultValue="1" className="input">
            <option value="1">1 business day</option>
            <option value="2">2 business days</option>
            <option value="3">3 business days</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="returnDays">Returns</label>
          <select id="returnDays" name="returnDays" defaultValue="30" className="input">
            <option value="30">30 days, buyer pays return shipping</option>
            <option value="60">60 days, buyer pays return shipping</option>
            <option value="0">No returns</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create my eBay policies"}</button>
        {state?.saved && <span className="text-sm text-green-700">Created and selected below.</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

"use client";

import { useFormAction } from "./use-form-action";
import type { StoreSettingsState } from "@/app/(app)/stores/actions";
import type { EbayConnectionSettings } from "@/db/schema";
import type { EbayPolicies } from "@/lib/marketplaces/ebay/adapter";

const policyFields = [
  { name: "fulfillmentPolicyId", kind: "fulfillment", label: "Shipping policy" },
  { name: "paymentPolicyId", kind: "payment", label: "Payment policy" },
  { name: "returnPolicyId", kind: "return", label: "Return policy" },
] as const;

export function EbaySettingsForm(props: {
  action: (state: StoreSettingsState, formData: FormData) => Promise<StoreSettingsState>;
  policies: EbayPolicies;
  settings: EbayConnectionSettings;
}) {
  const { state, onSubmit, pending } = useFormAction(props.action);
  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
      {policyFields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>{f.label}</label>
          <select id={f.name} name={f.name} className="input" defaultValue={props.settings[f.name] ?? ""}>
            <option value="">Choose…</option>
            {props.policies[f.kind].map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      ))}
      <div>
        <label className="label" htmlFor="postalCode">Ship-from ZIP code</label>
        <div className="flex gap-2">
          <input id="postalCode" name="postalCode" className="input" defaultValue={props.settings.postalCode ?? ""} />
          <select name="country" className="input w-24" defaultValue={props.settings.country ?? "US"}>
            <option value="US">US</option>
            <option value="CA">CA</option>
            <option value="GB">GB</option>
          </select>
        </div>
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save eBay settings"}</button>
        {state?.saved && <span className="text-sm text-green-700">Saved.</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

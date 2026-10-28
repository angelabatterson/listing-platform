"use client";

import type { StoreSettingsState } from "@/app/(app)/stores/actions";
import type { EtsyConnectionSettings } from "@/db/schema";
import type { EtsyShopOptions } from "@/lib/marketplaces/etsy/adapter";
import { ETSY_WHO_MADE } from "@/lib/marketplaces/etsy/config";
import { useFormAction } from "./use-form-action";

const fields = [
  { name: "shippingProfileId", options: "shippingProfiles", label: "Shipping profile" },
  { name: "returnPolicyId", options: "returnPolicies", label: "Return policy" },
  { name: "readinessStateId", options: "processingProfiles", label: "Processing profile" },
] as const;

export function EtsySettingsForm(props: {
  action: (state: StoreSettingsState, formData: FormData) => Promise<StoreSettingsState>;
  options: EtsyShopOptions;
  settings: EtsyConnectionSettings;
}) {
  const { state, onSubmit, pending } = useFormAction(props.action);
  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={`etsy_${f.name}`}>{f.label}</label>
          <select id={`etsy_${f.name}`} name={f.name} className="input" defaultValue={props.settings[f.name] ?? ""}>
            <option value="">Choose…</option>
            {props.options[f.options].map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      ))}
      <div>
        <label className="label" htmlFor="etsy_whoMade">Who made your items?</label>
        <select id="etsy_whoMade" name="whoMade" className="input" defaultValue={props.settings.whoMade ?? "someone_else"}>
          {ETSY_WHO_MADE.map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save Etsy settings"}</button>
        {state?.saved && <span className="text-sm text-green-700">Saved.</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

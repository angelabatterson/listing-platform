"use client";

import { useEffect, useId, useRef } from "react";
import { useFormAction } from "./use-form-action";
import type { SettingsState } from "@/app/(app)/account/actions";

type Field = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  required?: boolean;
};

// One section of the account settings page. Password fields are cleared after a
// successful save; other fields keep what was typed.
export function SettingsForm(props: {
  title: string;
  submitLabel: string;
  fields: Field[];
  action: (state: SettingsState, formData: FormData) => Promise<SettingsState>;
}) {
  const { state, onSubmit, pending } = useFormAction(props.action);
  const form = useRef<HTMLFormElement>(null);
  // Several forms share a page, so field ids are made unique per form.
  const uid = useId();
  useEffect(() => {
    if (!state?.saved) return;
    form.current?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
      input.value = "";
    });
  }, [state]);
  return (
    <form ref={form} onSubmit={onSubmit} className="card flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={`${uid}-${f.name}`} className="label">{f.label}</label>
          <input
            id={`${uid}-${f.name}`}
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            defaultValue={f.defaultValue}
            required={f.required ?? true}
            className="input"
          />
        </div>
      ))}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.saved && !pending && <p className="text-sm text-green-700">{state.saved}</p>}
      <div>
        <button className="btn" disabled={pending}>{pending ? "Saving…" : props.submitLabel}</button>
      </div>
    </form>
  );
}

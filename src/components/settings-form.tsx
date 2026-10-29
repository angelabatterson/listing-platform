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
  description?: string;
  submitLabel: string;
  // Styles the section and button for an action that can't be undone.
  danger?: boolean;
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
    <form ref={form} onSubmit={onSubmit} className={`card flex flex-col gap-4 ${props.danger ? "border-red-200" : ""}`}>
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.description && <p className="text-sm text-zinc-600">{props.description}</p>}
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
        <button className={props.danger ? "btn bg-red-700 hover:bg-red-600" : "btn"} disabled={pending}>{pending ? "Saving…" : props.submitLabel}</button>
      </div>
    </form>
  );
}

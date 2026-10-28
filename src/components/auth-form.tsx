"use client";

import Link from "next/link";
import { useFormAction } from "./use-form-action";
import type { AuthState } from "@/app/(auth)/actions";

type Field = { name: string; label: string; type?: string; autoComplete?: string; required?: boolean };

export function AuthForm(props: {
  title: string;
  submitLabel: string;
  fields: Field[];
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  footer: { text: string; href: string; link: string };
}) {
  const { state, onSubmit, pending } = useFormAction(props.action);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">{props.title}</h1>
      <form onSubmit={onSubmit} className="card flex flex-col gap-4">
        {props.fields.map((f) => (
          <div key={f.name}>
            <label htmlFor={f.name} className="label">{f.label}</label>
            <input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              required={f.required ?? true}
              className="input"
            />
          </div>
        ))}
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn" disabled={pending}>{pending ? "Please wait…" : props.submitLabel}</button>
      </form>
      <p className="mt-4 text-sm text-zinc-600">
        {props.footer.text}{" "}
        <Link href={props.footer.href} className="font-medium underline">{props.footer.link}</Link>
      </p>
    </main>
  );
}

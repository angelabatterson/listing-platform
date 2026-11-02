"use client";

import { useState, useTransition } from "react";
import {
  cancelInvite,
  inviteHelper,
  newInviteLink,
  removeHelper,
  saveHelperPages,
  type InviteState,
} from "@/app/(app)/team/actions";
import { TEAM_PAGES } from "@/lib/team";
import { useFormAction } from "./use-form-action";

function PageChecks({ chosen }: { chosen: string[] }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="label mb-2">Pages they can use</legend>
      {TEAM_PAGES.map((p) => (
        <label key={p.key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pages" value={p.key} defaultChecked={chosen.includes(p.key)} />
          {p.label}
        </label>
      ))}
    </fieldset>
  );
}

// The link to send, shown once: only a hash of it is kept.
function InviteLink({ state }: { state: InviteState }) {
  const [copied, setCopied] = useState(false);
  if (!state?.link) return null;
  return (
    <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
      <p className="mb-2 text-green-900">
        Send this link to <strong>{state.email}</strong> by text or email. It works once, for 7 days.
      </p>
      <div className="flex gap-2">
        <input readOnly value={state.link} className="input flex-1 bg-white" onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
        <button
          type="button"
          className="btn"
          onClick={() => {
            navigator.clipboard?.writeText(state.link!).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function InviteForm({ blocked }: { blocked: string | null }) {
  const { state, onSubmit, pending } = useFormAction(inviteHelper);
  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Invite a helper</h2>
      {blocked ? (
        <p className="text-sm text-zinc-600">{blocked}</p>
      ) : (
        <>
          <div>
            <label htmlFor="invite-email" className="label">Their email</label>
            <input id="invite-email" name="email" type="email" required autoComplete="off" className="input" />
          </div>
          <PageChecks chosen={["items", "batches"]} />
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          <InviteLink state={state} />
          <div>
            <button className="btn" disabled={pending}>{pending ? "Please wait…" : "Make invite link"}</button>
          </div>
        </>
      )}
    </form>
  );
}

export function PendingInvite({ id, email, expires }: { id: string; email: string; expires: string }) {
  const [state, setState] = useState<InviteState>();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{email}</span>
          <span className="text-zinc-500"> · invite link works until {expires}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => start(async () => setState(await newInviteLink(id)))}>
            New link
          </button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => start(() => cancelInvite(id))}>
            Cancel invite
          </button>
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <InviteLink state={state} />
    </li>
  );
}

export function HelperRow({ id, label, email, pages }: { id: string; label: string; email: string; pages: string[] }) {
  const { state, onSubmit, pending } = useFormAction(saveHelperPages);
  const [removing, start] = useTransition();
  return (
    <li className="py-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="helperId" value={id} />
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-sm text-zinc-500">{email}</p>
        </div>
        <PageChecks chosen={pages} />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.saved && !pending && <p className="text-sm text-green-700">{state.saved}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save pages"}</button>
          <button
            type="button"
            className="btn-secondary text-red-700"
            disabled={removing}
            onClick={() => {
              if (confirm(`Remove ${label}? They'll be logged out and can't log in again. Their work stays.`)) start(() => removeHelper(id));
            }}
          >
            Remove helper
          </button>
        </div>
      </form>
    </li>
  );
}

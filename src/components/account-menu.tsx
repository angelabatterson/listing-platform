"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// The menu under the signed-in user's name: account settings, billing and log out.
export function AccountMenu(props: { label: string; email: string; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  // Close on a click elsewhere or on Escape; the links close it themselves.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "block w-full px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
      >
        {props.label}
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg">
          <p className="truncate border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">{props.email}</p>
          <Link href="/account" role="menuitem" className={item} onClick={close}>Account settings</Link>
          <Link href="/billing" role="menuitem" className={item} onClick={close}>Billing</Link>
          <form action={props.logout} className="border-t border-zinc-100">
            <button role="menuitem" className={item}>Log out</button>
          </form>
        </div>
      )}
    </div>
  );
}

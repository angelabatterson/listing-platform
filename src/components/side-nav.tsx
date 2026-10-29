"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AccountMenu } from "./account-menu";
import { LogoMark } from "./logo";

// Outline icons (24px grid), drawn with the text colour.
const ICONS: Record<string, string> = {
  dashboard: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z",
  inventory: "M4 7h16M4 7l1 13h14l1-13M4 7l2-4h12l2 4M9 11h6",
  batches: "M4 7h3l2-3h6l2 3h3v13H4V7Zm8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  crm: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  activity: "M3 12h4l3-8 4 16 3-8h4",
};

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/items", label: "Inventory", icon: "inventory" },
  { href: "/batches", label: "Photo batches", icon: "batches" },
  { href: "/crm", label: "CRM", icon: "crm" },
  { href: "/activity", label: "Activity", icon: "activity" },
];

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5 shrink-0">
      <path d={ICONS[name]} />
    </svg>
  );
}

// The app's menu: a bar down the left on wider screens, and a menu button on phones.
export function SideNav(props: { label: string; email: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
              active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            <Icon name={n.icon} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Phones: a top bar with a menu button. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <LogoMark className="h-6 w-6" />
          Relistic
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Menu"
          className="rounded-md p-2 text-zinc-700 hover:bg-zinc-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-6 w-6">
            <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </svg>
        </button>
      </header>
      {open && (
        <div className="border-b border-zinc-200 bg-white px-4 pb-4 md:hidden">
          {links}
          <div className="mt-3 border-t border-zinc-100 px-3 pt-3">
            <AccountMenu label={props.label} email={props.email} logout={props.logout} />
          </div>
        </div>
      )}

      {/* Wider screens: a fixed bar down the left. */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white px-3 py-4 md:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-3 font-semibold">
          <LogoMark className="h-7 w-7" />
          Relistic
        </Link>
        {links}
        <div className="mt-auto border-t border-zinc-100 px-3 pt-3">
          <AccountMenu label={props.label} email={props.email} logout={props.logout} up />
        </div>
      </aside>
    </>
  );
}

import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { requireUser } from "@/lib/auth";

const nav = [
  { href: "/items", label: "Inventory" },
  { href: "/stores", label: "Stores" },
  { href: "/activity", label: "Activity" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <Link href="/items" className="font-semibold">Listing Sync</Link>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="text-zinc-600 hover:text-zinc-900">{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-zinc-600">
            <span>{user.email}</span>
            <form action={logout}>
              <button className="underline">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
      {/* Etsy requires this notice in apps that use its API. */}
      <footer className="mx-auto w-full max-w-5xl px-6 py-6 text-xs text-zinc-500">
        The term &quot;Etsy&quot; is a trademark of Etsy, Inc. This application uses the Etsy API but is not
        endorsed or certified by Etsy, Inc.
      </footer>
    </div>
  );
}

import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { AccountMenu } from "@/components/account-menu";
import { LogoMark } from "@/components/logo";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/billing/access";
import { daysLeft, inactiveMessage, type Access } from "@/lib/billing/plans";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/items", label: "Inventory" },
  { href: "/batches", label: "Photo batches" },
  { href: "/shipping", label: "Shipping" },
  { href: "/stores", label: "Stores" },
  { href: "/activity", label: "Activity" },
];

function BillingBanner({ access }: { access: Access }) {
  let text: string;
  let tone = "border-amber-200 bg-amber-50 text-amber-900";
  if (access.state === "trial") {
    const days = daysLeft(access.trialEndsAt);
    if (days > 3) return null;
    text = `Your free trial ends in ${days} ${days === 1 ? "day" : "days"}. Choose a plan to keep listing.`;
  } else if (access.state === "past_due") {
    text = "Your last payment didn't go through. Update your card to keep your account running.";
  } else if (access.state === "inactive") {
    text = inactiveMessage(access);
    tone = "border-red-200 bg-red-50 text-red-900";
  } else {
    return null;
  }
  return (
    <div className={`border-b ${tone}`}>
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-2 text-sm">
        <span>{text}</span>
        <Link href="/billing" className="shrink-0 font-medium underline">Billing</Link>
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const access = await getAccess(user);
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/items" className="flex items-center gap-2 font-semibold">
            <LogoMark className="h-6 w-6" />
            Relistic
          </Link>
          <nav className="order-last flex w-full gap-4 overflow-x-auto text-sm md:order-none md:w-auto">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap text-zinc-600 hover:text-zinc-900">{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto">
            <AccountMenu label={user.name || user.email} email={user.email} logout={logout} />
          </div>
        </div>
      </header>
      <BillingBanner access={access} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
      {/* Etsy requires this notice in apps that use its API. */}
      <footer className="mx-auto w-full max-w-5xl px-6 py-6 text-xs text-zinc-500">
        The term &quot;Etsy&quot; is a trademark of Etsy, Inc. This application uses the Etsy API but is not
        endorsed or certified by Etsy, Inc.
      </footer>
    </div>
  );
}

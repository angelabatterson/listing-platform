import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { SideNav } from "@/components/side-nav";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/billing/access";
import { daysLeft, inactiveMessage, type Access } from "@/lib/billing/plans";

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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 text-sm md:px-8">
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
    <div className="flex flex-1 flex-col md:flex-row">
      <SideNav label={user.name || user.email} email={user.email} logout={logout} />
      <div className="flex min-w-0 flex-1 flex-col">
        <BillingBanner access={access} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        {/* Etsy requires this notice in apps that use its API. */}
        <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-zinc-500 md:px-8">
          The term &quot;Etsy&quot; is a trademark of Etsy, Inc. This application uses the Etsy API but is not
          endorsed or certified by Etsy, Inc.
        </footer>
      </div>
    </div>
  );
}

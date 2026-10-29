import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccess, usage } from "@/lib/billing/access";
import {
  daysLeft,
  hasLiveSubscription,
  inactiveMessage,
  PLAN_KEYS,
  PLANS,
  priceIdFor,
  type Access,
  type PlanKey,
} from "@/lib/billing/plans";
import { billingEnabled, stripe } from "@/lib/billing/stripe";
import { choosePlan, openBillingPortal } from "./actions";

const formatDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// Prices are read from Stripe so the page always shows what checkout will charge.
async function priceLabel(plan: PlanKey): Promise<string | null> {
  const id = priceIdFor(plan);
  if (!id) return null;
  try {
    const price = await stripe().prices.retrieve(id);
    if (price.unit_amount === null) return null;
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency }).format(
      price.unit_amount / 100,
    );
    return price.recurring ? `${amount} / ${price.recurring.interval}` : amount;
  } catch (err) {
    console.error("Couldn't load a Stripe price", err);
    return null;
  }
}

function limitText(n: number | null, unit: string) {
  return n === null ? `Unlimited ${unit}` : `${n.toLocaleString("en-US")} ${unit}`;
}

function Meter(props: { label: string; used: number; cap: number | null }) {
  const pct = props.cap ? Math.min(100, Math.round((props.used / props.cap) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{props.label}</span>
        <span className="text-zinc-600">
          {props.used.toLocaleString("en-US")}
          {props.cap === null ? " (unlimited)" : ` of ${props.cap.toLocaleString("en-US")}`}
        </span>
      </div>
      {props.cap !== null && (
        <div className="mt-1 h-2 overflow-hidden rounded bg-zinc-100">
          <div className={`h-full ${pct >= 100 ? "bg-red-600" : "bg-zinc-900"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function StatusText(props: { access: Access; periodEnd: Date | null; cancelling: boolean }) {
  const { access } = props;
  switch (access.state) {
    case "free":
      return <p>Your account has full use and doesn&apos;t need a plan.</p>;
    case "trial":
      return (
        <p>
          You&apos;re on the free trial, with <strong>{daysLeft(access.trialEndsAt)} days left</strong> (it ends{" "}
          {formatDate(access.trialEndsAt)}). Choose a plan below to keep going after that. If you choose now, your
          card isn&apos;t charged until the trial ends.
        </p>
      );
    case "active":
      return (
        <p>
          You&apos;re on the <strong>{access.plan ? PLANS[access.plan].name : "current"}</strong> plan.
          {props.periodEnd &&
            (props.cancelling
              ? ` It's set to end on ${formatDate(props.periodEnd)}.`
              : ` It renews on ${formatDate(props.periodEnd)}.`)}
        </p>
      );
    case "past_due":
      return (
        <p className="text-amber-800">
          Your last payment didn&apos;t go through. Stripe will try again; update your card under{" "}
          <strong>Manage billing</strong> so your account isn&apos;t paused.
        </p>
      );
    case "inactive":
      return <p className="text-red-700">{inactiveMessage(access)} Your listings and data are kept.</p>;
  }
}

function PlanCard(props: { plan: PlanKey; price: string | null; current: boolean; subscribed: boolean }) {
  const { name, limits } = PLANS[props.plan];
  return (
    <div className={`card flex flex-col gap-3 ${props.current ? "border-zinc-900" : ""}`}>
      <div>
        <h3 className="text-lg font-semibold">{name}</h3>
        <p className="text-sm text-zinc-600">{props.price ?? "Price not set up yet"}</p>
      </div>
      <ul className="flex-1 space-y-1 text-sm">
        <li>{limitText(limits.activeListings, "active listings")}</li>
        <li>{limitText(limits.aiDraftsPerMonth, "AI drafts a month")}</li>
        <li>eBay and Etsy, with sales synced across stores</li>
      </ul>
      {props.current ? (
        <span className="text-sm font-medium">Your current plan</span>
      ) : (
        <form action={choosePlan.bind(null, props.plan)}>
          <button className={props.subscribed ? "btn-secondary w-full" : "btn w-full"} disabled={!props.price}>
            {props.subscribed ? `Switch to ${name}` : `Choose ${name}`}
          </button>
        </form>
      )}
    </div>
  );
}

export default async function BillingPage(props: PageProps<"/billing">) {
  const { checkout } = await props.searchParams;
  const user = await requireUser();

  if (!billingEnabled()) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">Billing</h1>
        <div className="card text-zinc-600">
          Billing isn&apos;t switched on yet, so every account has full use. Add the Stripe settings on the server to
          turn it on.
        </div>
      </div>
    );
  }

  const [access, used, org, prices] = await Promise.all([
    getAccess(user),
    usage(user.organizationId),
    db.query.organizations.findFirst({ where: eq(organizations.id, user.organizationId) }),
    Promise.all(PLAN_KEYS.map(priceLabel)),
  ]);
  const subscribed = hasLiveSubscription(org?.subscriptionStatus ?? null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Billing</h1>
        {org?.stripeCustomerId && (
          <form action={openBillingPortal}>
            <button className="btn-secondary">Manage billing</button>
          </form>
        )}
      </div>

      {checkout === "done" && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Thanks! Your plan is being set up. It can take a few seconds to show here; refresh the page if it
          hasn&apos;t changed.
        </div>
      )}

      <div className="card space-y-4">
        <StatusText access={access} periodEnd={org?.currentPeriodEnd ?? null} cancelling={org?.cancelAtPeriodEnd ?? false} />
        {access.state !== "free" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Meter label="Active listings" used={used.activeListings} cap={access.limits.activeListings} />
            <Meter label="AI drafts this month" used={used.aiDraftsThisMonth} cap={access.limits.aiDraftsPerMonth} />
          </div>
        )}
      </div>

      {access.state !== "free" && (
        <div className="grid gap-4 sm:grid-cols-3">
          {PLAN_KEYS.map((plan, i) => (
            <PlanCard
              key={plan}
              plan={plan}
              price={prices[i]}
              current={subscribed && access.plan === plan}
              subscribed={subscribed}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Payments are handled by Stripe. Card details never reach this app. Cancel anytime from Manage billing.
      </p>
    </div>
  );
}

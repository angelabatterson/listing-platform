import type Stripe from "stripe";
import { applySubscription } from "@/lib/billing/access";
import { stripe } from "@/lib/billing/stripe";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

function subscriptionId(event: Stripe.Event): string | null {
  if (event.type === "checkout.session.completed") {
    const sub = event.data.object.subscription;
    return typeof sub === "string" ? sub : (sub?.id ?? null);
  }
  if (SUBSCRIPTION_EVENTS.has(event.type)) return (event.data.object as Stripe.Subscription).id;
  return null;
}

// Stripe calls this when a checkout finishes or a subscription changes. Register it in
// Stripe's Workbench > Webhooks as ${APP_URL}/api/stripe/webhook (see README).
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return new Response("Billing isn't set up", { status: 503 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }

  const id = subscriptionId(event);
  if (id) {
    // Fetch the latest state rather than trusting the event, which may be stale.
    const sub = await stripe().subscriptions.retrieve(id);
    await applySubscription(sub);
  }
  return new Response("ok");
}

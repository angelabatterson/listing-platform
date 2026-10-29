import "server-only";
import Stripe from "stripe";

// Billing is switched on by setting STRIPE_SECRET_KEY. Without it every account has
// full use, which keeps local development and self-testing simple.
export function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let client: Stripe | undefined;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY isn't set");
  client ??= new Stripe(key);
  return client;
}

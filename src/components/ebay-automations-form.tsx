"use client";

import { useState } from "react";
import { useFormAction } from "./use-form-action";
import type { ApplyStep, AutomationsState } from "@/app/(app)/automations/actions";
import type { EbayAutomations } from "@/db/schema";

export function EbayAutomationsForm(props: {
  automations: EbayAutomations;
  save: (state: AutomationsState, formData: FormData) => Promise<AutomationsState>;
  apply: (after: string | null) => Promise<ApplyStep>;
}) {
  const [progress, setProgress] = useState<string | null>(null);

  // After a Best Offer change, update the listings already on eBay, a few at a time.
  async function applyToListings() {
    let after: string | null = null;
    let done = 0;
    let failed = 0;
    let total = 0;
    do {
      const step: ApplyStep = await props
        .apply(after)
        .catch(() => ({ error: "Lost the connection.", count: 0, total, failed: 0, next: null }));
      if (step.error) {
        setProgress(`Stopped: ${step.error} Press Save again to finish updating your listings.`);
        return;
      }
      total = total || step.total;
      done += step.count;
      failed += step.failed;
      after = step.next;
      setProgress(`Updating your eBay listings: ${done} of ${total} done…`);
    } while (after);
    setProgress(
      total === 0
        ? null
        : `Updated ${done - failed} of ${total} eBay listings.${failed ? ` ${failed} had a problem; see Activity.` : ""}`,
    );
  }

  const { state, onSubmit, pending } = useFormAction(async (prev: AutomationsState, formData: FormData) => {
    setProgress(null);
    const result = await props.save(prev, formData);
    if (result?.bestOfferChanged) await applyToListings();
    return result;
  });
  const bestOffer = props.automations.bestOffer ?? { enabled: false, acceptPct: 90, declinePct: 70 };
  const watchers = props.automations.watcherOffers ?? { enabled: false, discountPct: 10 };
  const relist = props.automations.relist ?? { enabled: false, afterDays: 30, dropPct: 5, floorPct: 70, perDay: 25 };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Best Offer</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Lets buyers send you offers on your eBay listings. eBay accepts or declines them for you, based on a percent
            of each listing&apos;s price. Offers in between are left for you to answer on eBay.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="bestOfferEnabled" defaultChecked={bestOffer.enabled} className="h-4 w-4" />
          Turn on Best Offer for my eBay listings
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="acceptPct">Auto-accept offers at or above (% of price)</label>
            <input id="acceptPct" name="acceptPct" type="number" min={0} max={99} className="input" defaultValue={bestOffer.acceptPct} />
            <p className="mt-1 text-xs text-zinc-500">Example: 90 on a $50 item accepts offers of $45 or more. 0 means never.</p>
          </div>
          <div>
            <label className="label" htmlFor="declinePct">Auto-decline offers below (% of price)</label>
            <input id="declinePct" name="declinePct" type="number" min={0} max={99} className="input" defaultValue={bestOffer.declinePct} />
            <p className="mt-1 text-xs text-zinc-500">Example: 70 on a $50 item declines offers under $35. 0 means never.</p>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Offers to watchers</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Once a day, Relistic sends a discount offer to buyers who are watching your eBay listings or have them in
            their cart. Buyers have 2 days to accept. eBay only allows one offer to the same listing&apos;s watchers every
            few days, and skips listings with nobody watching.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="watcherOffersEnabled" defaultChecked={watchers.enabled} className="h-4 w-4" />
          Send offers to watchers every day
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="discountPct">Discount (% off the price)</label>
            <input id="discountPct" name="discountPct" type="number" min={5} max={80} className="input" defaultValue={watchers.discountPct} />
            <p className="mt-1 text-xs text-zinc-500">eBay&apos;s smallest discount is 5%.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="message">Message to buyers (optional)</label>
            <textarea id="message" name="message" rows={2} maxLength={2000} className="input" defaultValue={watchers.message ?? ""} placeholder="Thanks for watching! Here's a little discount." />
          </div>
        </div>
        {watchers.lastRunAt && (
          <p className="text-xs text-zinc-500">Last checked for watchers: {new Date(watchers.lastRunAt).toLocaleString()}</p>
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Relist listings that haven&apos;t sold</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Once a day, Relistic ends eBay listings that have been up a while without selling and lists them again, so
            they show up as new in eBay search. It can lower the price a little each time. The new listing loses its
            watchers, so leave offers to watchers on as well.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="relistEnabled" defaultChecked={relist.enabled} className="h-4 w-4" />
          Relist listings that haven&apos;t sold
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="afterDays">Relist after (days without selling)</label>
            <input id="afterDays" name="afterDays" type="number" min={3} max={180} className="input" defaultValue={relist.afterDays} />
          </div>
          <div>
            <label className="label" htmlFor="dropPct">Lower the price each relist by (%)</label>
            <input id="dropPct" name="dropPct" type="number" min={0} max={50} className="input" defaultValue={relist.dropPct} />
            <p className="mt-1 text-xs text-zinc-500">0 keeps the same price.</p>
          </div>
          <div>
            <label className="label" htmlFor="floorPct">Never go below (% of the item&apos;s price)</label>
            <input id="floorPct" name="floorPct" type="number" min={0} max={100} className="input" defaultValue={relist.floorPct} />
            <p className="mt-1 text-xs text-zinc-500">Example: 70 on a $50 item stops dropping at $35.</p>
          </div>
          <div>
            <label className="label" htmlFor="perDay">Most listings to relist per day</label>
            <input id="perDay" name="perDay" type="number" min={1} max={200} className="input" defaultValue={relist.perDay} />
          </div>
        </div>
        {relist.lastRunAt && (
          <p className="text-xs text-zinc-500">Last checked: {new Date(relist.lastRunAt).toLocaleString()}</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save eBay automations"}</button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state?.saved && !progress && <span className="text-sm text-green-700">Saved.</span>}
        {progress && <span className="text-sm text-zinc-700">{progress}</span>}
      </div>
    </form>
  );
}

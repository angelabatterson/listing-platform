import Link from "next/link";
import { money, shortDate } from "@/components/money";
import { SettingsForm } from "@/components/settings-form";
import { requireUser } from "@/lib/auth";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { getShippingSettings, ordersToShip, recentLabels, SHIP_WINDOW_DAYS } from "@/lib/shipping/settings";
import { retryTracking, saveDefaultParcel, saveFromAddress, saveShippoKey } from "./actions";

function Settings(props: { settings: Awaited<ReturnType<typeof getShippingSettings>> }) {
  const s = props.settings;
  const a = s?.fromAddress;
  const p = s?.defaultParcel;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <SettingsForm
          title="1. Your Shippo key"
          description={
            s?.apiTokenEnc
              ? `A ${s.testMode ? "test" : "live"} key is saved. Paste a new one here to replace it.`
              : "Labels are bought through your own free Shippo account, and Shippo charges you for postage. In Shippo, open Settings, then API, and copy your Live Token. It starts with shippo_live_."
          }
          submitLabel="Save key"
          action={saveShippoKey}
          fields={[{ name: "token", label: "Shippo API token", type: "password", autoComplete: "off", placeholder: "shippo_live_…" }]}
        />
        <SettingsForm
          title="3. Your usual box"
          description="Filled in for each new label, so you only change it when a parcel is different."
          submitLabel="Save box"
          action={saveDefaultParcel}
          fields={[
            { name: "lengthIn", label: "Length (inches)", type: "number", step: "any", defaultValue: p ? String(p.lengthIn) : "10" },
            { name: "widthIn", label: "Width (inches)", type: "number", step: "any", defaultValue: p ? String(p.widthIn) : "8" },
            { name: "heightIn", label: "Height (inches)", type: "number", step: "any", defaultValue: p ? String(p.heightIn) : "4" },
            { name: "pounds", label: "Weight: pounds", type: "number", step: "any", defaultValue: p ? String(Math.floor(p.weightOz / 16)) : "1", required: false },
            { name: "ounces", label: "Weight: ounces", type: "number", step: "any", defaultValue: p ? String(Math.round((p.weightOz % 16) * 10) / 10) : "0", required: false },
          ]}
        />
      </div>
      <SettingsForm
        title="2. Where you ship from"
        description="Printed as the return address on your labels."
        submitLabel="Save address"
        action={saveFromAddress}
        fields={[
          { name: "name", label: "Name", autoComplete: "name", defaultValue: a?.name },
          { name: "company", label: "Business name (optional)", autoComplete: "organization", defaultValue: a?.company, required: false },
          { name: "street1", label: "Street address", autoComplete: "address-line1", defaultValue: a?.street1 },
          { name: "street2", label: "Apartment, suite (optional)", autoComplete: "address-line2", defaultValue: a?.street2, required: false },
          { name: "city", label: "City", autoComplete: "address-level2", defaultValue: a?.city },
          { name: "state", label: "State (2 letters)", autoComplete: "address-level1", defaultValue: a?.state },
          { name: "zip", label: "ZIP code", autoComplete: "postal-code", defaultValue: a?.zip },
          { name: "phone", label: "Phone", type: "tel", autoComplete: "tel", defaultValue: a?.phone },
          { name: "email", label: "Email (optional)", type: "email", autoComplete: "email", defaultValue: a?.email, required: false },
        ]}
      />
    </div>
  );
}

export default async function ShippingPage() {
  const user = await requireUser();
  const org = user.organizationId;
  const [settings, toShip, labels] = await Promise.all([getShippingSettings(org), ordersToShip(org), recentLabels(org)]);
  const ready = Boolean(settings?.apiTokenEnc && settings.fromAddress);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Shipping</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Buy a label for any order from your stores. The tracking number is sent to eBay or Etsy for you, which also
          lets the buyer know it&apos;s on the way.
        </p>
      </div>

      {settings?.testMode && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You&apos;re using a Shippo <strong>test</strong> key, so labels are free samples that can&apos;t be mailed,
          and tracking isn&apos;t sent to your stores.
        </div>
      )}

      {!ready && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Set up shipping</h2>
          <Settings settings={settings} />
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold">Ready to ship</h2>
        <p className="mb-3 text-sm text-zinc-600">
          Orders from the last {SHIP_WINDOW_DAYS} days without a Relistic label. If you shipped one another way, you can
          ignore it.
        </p>
        {toShip.length === 0 ? (
          <p className="text-sm text-zinc-600">Nothing waiting. New sales show up here.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
            {toShip.map((o) => (
              <li key={`${o.connectionId}:${o.orderId}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {o.titles.join(", ")}
                    {o.units > o.titles.length && <span className="text-zinc-500"> ({o.units} items)</span>}
                  </div>
                  <div className="text-zinc-500">
                    {MARKETPLACE_LABELS[o.marketplace]} · {o.buyerName ?? "Buyer"} · sold {shortDate(o.soldAt)}
                  </div>
                </div>
                {ready ? (
                  <Link href={`/shipping/${o.connectionId}/${encodeURIComponent(o.orderId)}`} className="btn">Ship</Link>
                ) : (
                  <span className="text-zinc-500">Finish setup to ship</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Labels bought</h2>
        {labels.length === 0 ? (
          <p className="text-sm text-zinc-600">No labels yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
            {labels.map(({ label: l, marketplace }) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {l.carrier} {l.service} · {money(l.costCents)}
                    {l.testMode && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Test</span>}
                  </div>
                  <div className="text-zinc-500">
                    {MARKETPLACE_LABELS[marketplace]} order {l.externalOrderId} · {shortDate(l.createdAt)}
                    {l.trackingNumber && (
                      <>
                        {" · "}
                        {l.trackingUrl ? (
                          <a href={l.trackingUrl} target="_blank" rel="noreferrer" className="underline">{l.trackingNumber}</a>
                        ) : (
                          l.trackingNumber
                        )}
                      </>
                    )}
                  </div>
                  {l.trackingSentAt ? (
                    <div className="text-green-700">Tracking sent to {MARKETPLACE_LABELS[marketplace]}.</div>
                  ) : (
                    l.trackingError && <div className="text-red-700">Tracking not sent: {l.trackingError}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  {!l.trackingSentAt && !l.testMode && l.trackingNumber && (
                    <form action={retryTracking.bind(null, l.id)}>
                      <button className="btn-secondary">Send tracking again</button>
                    </form>
                  )}
                  <a href={l.labelUrl} target="_blank" rel="noreferrer" className="btn-secondary">Print label</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ready && (
        <details className="rounded-lg border border-zinc-200 bg-white p-4">
          <summary className="cursor-pointer font-medium">Shipping settings</summary>
          <div className="mt-4">
            <Settings settings={settings} />
          </div>
        </details>
      )}
    </div>
  );
}

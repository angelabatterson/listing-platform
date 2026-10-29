import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { money, shortDate } from "@/components/money";
import { RatePicker } from "@/components/rate-picker";
import { db } from "@/db";
import { connections, sales, shippingLabels } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { fetchOrderToShip, type OrderToShip } from "@/lib/shipping/orders";
import { readyShipping } from "@/lib/shipping/settings";
import { buyShippingLabel, quoteRates, retryTracking } from "../../actions";

export default async function ShipOrderPage(props: PageProps<"/shipping/[connectionId]/[orderId]">) {
  const { connectionId, orderId: rawOrderId } = await props.params;
  const { bought } = await props.searchParams;
  const orderId = decodeURIComponent(rawOrderId);
  const user = await requireUser();
  const org = user.organizationId;

  const lines = await db.query.sales.findMany({
    where: and(eq(sales.organizationId, org), eq(sales.connectionId, connectionId), eq(sales.externalOrderId, orderId)),
    orderBy: asc(sales.externalLineId),
    with: { item: { columns: { title: true } } },
  });
  const connection = lines.length
    ? await db.query.connections.findFirst({ where: and(eq(connections.id, connectionId), eq(connections.organizationId, org)) })
    : undefined;
  if (!connection) notFound();
  const store = MARKETPLACE_LABELS[connection.marketplace];

  const [labels, { ready, missing }] = await Promise.all([
    db.query.shippingLabels.findMany({
      where: and(
        eq(shippingLabels.organizationId, org),
        eq(shippingLabels.connectionId, connectionId),
        eq(shippingLabels.externalOrderId, orderId),
      ),
      orderBy: desc(shippingLabels.createdAt),
    }),
    readyShipping(org),
  ]);

  let order: OrderToShip | null = null;
  let orderError: string | null = null;
  try {
    order = await fetchOrderToShip(connection, orderId);
  } catch (err) {
    orderError = err instanceof Error ? err.message : String(err);
  }
  const to = order?.shipTo;

  return (
    <div className="space-y-6">
      <Link href="/shipping" className="text-sm text-zinc-600 hover:underline">← Shipping</Link>
      <div>
        <h1 className="text-2xl font-semibold">Ship {store} order {orderId}</h1>
        <p className="mt-1 text-sm text-zinc-600">Sold {shortDate(lines[0].soldAt)}</p>
      </div>

      {bought === "1" && labels[0] && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Label bought.{" "}
          <a href={labels[0].labelUrl} target="_blank" rel="noreferrer" className="font-medium underline">
            Open it to print
          </a>
          {labels[0].trackingSentAt && `. ${store} has the tracking number and will let the buyer know.`}
        </div>
      )}

      {labels.length > 0 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Labels for this order</h2>
          <ul className="divide-y divide-zinc-100 text-sm">
            {labels.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <div className="font-medium">
                    {l.carrier} {l.service} · {money(l.costCents)}
                    {l.testMode && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Test</span>}
                  </div>
                  <div className="text-zinc-500">
                    {l.trackingNumber ?? "No tracking number"}
                    {l.trackingSentAt ? ` · sent to ${store}` : l.trackingError ? ` · not sent: ${l.trackingError}` : ""}
                  </div>
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
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 text-lg font-semibold">Items</h2>
          <ul className="space-y-1 text-sm">
            {lines.map((l) => (
              <li key={l.id}>
                {l.item?.title ?? l.title ?? l.sku ?? "Item"}
                {l.quantity > 1 && <span className="text-zinc-500"> × {l.quantity}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="mb-2 text-lg font-semibold">Ship to</h2>
          {orderError ? (
            <p className="text-sm text-red-600">Couldn&apos;t load the order from {store}: {orderError}</p>
          ) : to ? (
            <address className="text-sm not-italic">
              {to.name}
              <br />
              {to.company && (
                <>
                  {to.company}
                  <br />
                </>
              )}
              {to.street1}
              {to.street2 && `, ${to.street2}`}
              <br />
              {to.city}, {to.state} {to.zip}
              {to.country !== "US" && ` ${to.country}`}
            </address>
          ) : (
            <p className="text-sm text-zinc-600">{store} didn&apos;t share a shipping address for this order.</p>
          )}
        </div>
      </div>

      {order?.shipped && labels.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {store} already shows this order as shipped. Only buy a label if you&apos;re sending something else.
        </div>
      )}

      {!ready ? (
        <div className="card text-sm">
          {missing} <Link href="/shipping" className="underline">Go to Shipping settings</Link>
        </div>
      ) : (
        to && (
          <RatePicker
            parcel={ready.defaultParcel}
            quote={quoteRates.bind(null, connectionId, orderId)}
            buy={buyShippingLabel.bind(null, connectionId, orderId)}
          />
        )
      )}
    </div>
  );
}

import { eq } from "drizzle-orm";
import { EbaySettingsForm } from "@/components/ebay-settings-form";
import { EtsySettingsForm } from "@/components/etsy-settings-form";
import { db } from "@/db";
import { connections, type Connection } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { fetchEbayPolicies } from "@/lib/marketplaces/ebay/adapter";
import { ebayEnvironment, ebayHosts, ebayIsConfigured } from "@/lib/marketplaces/ebay/config";
import { fetchEtsyShopOptions } from "@/lib/marketplaces/etsy/adapter";
import { etsyIsConfigured } from "@/lib/marketplaces/etsy/config";
import { isConnectionReady, storeLabel } from "@/lib/stores";
import { disconnectStore, saveEbaySettings, saveEtsySettings } from "./actions";

const errors: Record<string, string> = {
  ebay_declined: "eBay didn't grant access. Try connecting again and choose Agree.",
  ebay_state: "That eBay sign-in expired or didn't match. Please try again.",
  etsy_declined: "Etsy didn't grant access. Try connecting again and choose Allow Access.",
  etsy_state: "That Etsy sign-in expired or didn't match. Please try again.",
  etsy_no_shop: "That Etsy account doesn't have a shop yet. Open a shop on Etsy, then connect again.",
};

async function load<T>(fn: () => Promise<T>): Promise<{ data?: T; error?: string }> {
  try {
    return { data: await fn() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function statusText(c: Connection | undefined): string {
  if (!c) return "Not connected.";
  const name = MARKETPLACE_LABELS[c.marketplace];
  if (c.status === "needs_reauth") return `${name} sign-in expired. Reconnect to keep syncing.`;
  return isConnectionReady(c) ? "Connected and ready to list." : "Connected. Settings needed before listing.";
}

function StoreHeader(props: {
  connection: Connection | undefined;
  marketplace: Connection["marketplace"];
  configured: boolean;
  note?: string;
}) {
  const { connection, marketplace } = props;
  const name = MARKETPLACE_LABELS[marketplace];
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">{connection ? storeLabel(connection) : name}</h2>
        <p className="text-sm text-zinc-600">
          {statusText(connection)}
          {props.note}
        </p>
      </div>
      <div className="flex gap-2">
        {props.configured ? (
          <a href={`/api/${marketplace}/oauth/start`} className={connection ? "btn-secondary" : "btn"}>
            {connection ? "Reconnect" : `Connect ${name}`}
          </a>
        ) : (
          <span className="text-sm text-amber-700">{name} keys aren&apos;t set up on the server yet.</span>
        )}
        {connection && (
          <form action={disconnectStore.bind(null, connection.id)}>
            <button className="btn-secondary">Disconnect</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default async function StoresPage(props: PageProps<"/stores">) {
  const { error, connected } = await props.searchParams;
  const user = await requireUser();
  const conns = await db.query.connections.findMany({
    where: eq(connections.organizationId, user.organizationId),
  });
  const live = (m: Connection["marketplace"]) => conns.find((c) => c.marketplace === m && c.status !== "disconnected");
  const ebay = live("ebay");
  const etsy = live("etsy");
  const [ebayPolicies, etsyOptions] = await Promise.all([
    ebay ? load(() => fetchEbayPolicies(ebay)) : undefined,
    etsy?.settings.shopId ? load(() => fetchEtsyShopOptions(etsy)) : undefined,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Stores</h1>
      {typeof error === "string" && errors[error] && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">{errors[error]}</p>
      )}
      {(connected === "ebay" || connected === "etsy") && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
          {MARKETPLACE_LABELS[connected]} connected. Finish the settings below so items can be listed.
        </p>
      )}

      <section className="card">
        <StoreHeader
          connection={ebay}
          marketplace="ebay"
          configured={ebayIsConfigured()}
          note={ebayEnvironment() === "sandbox" ? " (eBay test environment)" : undefined}
        />
        {ebayPolicies?.error && (
          <p className="mt-4 text-sm text-red-600">Couldn&apos;t load your eBay business policies: {ebayPolicies.error}</p>
        )}
        {ebay && ebayPolicies?.data && (
          <>
            {Object.values(ebayPolicies.data).some((list) => list.length === 0) && (
              <p className="mt-4 text-sm text-amber-700">
                eBay needs a shipping, payment and return policy on your account.{" "}
                <a href={ebayHosts().policies} target="_blank" rel="noreferrer" className="underline">
                  Create them on eBay
                </a>
                , then reload this page.
              </p>
            )}
            <EbaySettingsForm
              action={saveEbaySettings.bind(null, ebay.id)}
              policies={ebayPolicies.data}
              settings={ebay.settings}
            />
          </>
        )}
      </section>

      <section className="card">
        <StoreHeader connection={etsy} marketplace="etsy" configured={etsyIsConfigured()} />
        {etsyOptions?.error && (
          <p className="mt-4 text-sm text-red-600">Couldn&apos;t load your Etsy shop settings: {etsyOptions.error}</p>
        )}
        {etsy && etsyOptions?.data && (
          <>
            {Object.values(etsyOptions.data).some((list) => list.length === 0) && (
              <p className="mt-4 text-sm text-amber-700">
                Etsy needs a shipping profile, return policy and processing profile on your shop.{" "}
                <a href="https://www.etsy.com/your/shops/me/tools/shipping-profiles" target="_blank" rel="noreferrer" className="underline">
                  Set them up on Etsy
                </a>
                , then reload this page.
              </p>
            )}
            <EtsySettingsForm
              action={saveEtsySettings.bind(null, etsy.id)}
              options={etsyOptions.data}
              settings={etsy.settings}
            />
          </>
        )}
      </section>
    </div>
  );
}

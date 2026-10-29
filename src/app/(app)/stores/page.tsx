import { desc, eq } from "drizzle-orm";
import { ConnectExtension } from "@/components/connect-extension";
import { EbaySettingsForm } from "@/components/ebay-settings-form";
import { EtsySettingsForm } from "@/components/etsy-settings-form";
import { db } from "@/db";
import { connections, extensionKeys, type Connection } from "@/db/schema";
import { newExtensionKey } from "@/app/(app)/extension/actions";
import { openTaskCounts } from "@/lib/extension/tasks";
import { EXTENSION_MARKETPLACES, type ExtensionMarketplace } from "@/lib/marketplaces/labels";
import { requireUser } from "@/lib/auth";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { fetchEbayPolicies } from "@/lib/marketplaces/ebay/adapter";
import { ebayEnvironment, ebayHosts, ebayIsConfigured } from "@/lib/marketplaces/ebay/config";
import { fetchEtsyShopOptions } from "@/lib/marketplaces/etsy/adapter";
import { etsyIsConfigured } from "@/lib/marketplaces/etsy/config";
import { isConnectionReady, storeLabel } from "@/lib/stores";
import { addExtensionStore, disconnectStore, saveEbaySettings, saveEtsySettings } from "./actions";

const EXTENSION_SITES: Record<ExtensionMarketplace, string> = {
  poshmark: "https://poshmark.com",
  depop: "https://www.depop.com",
  facebook: "https://www.facebook.com/marketplace",
  mercari: "https://www.mercari.com",
  whatnot: "https://www.whatnot.com",
};

function ago(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 120) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

async function ExtensionStores(props: { organizationId: string; conns: Connection[] }) {
  const added = props.conns.filter(
    (c) => (EXTENSION_MARKETPLACES as readonly string[]).includes(c.marketplace) && c.status !== "disconnected",
  );
  const [waiting, lastKey] = await Promise.all([
    openTaskCounts(props.organizationId, added.map((c) => c.id)),
    db.query.extensionKeys.findFirst({
      where: eq(extensionKeys.organizationId, props.organizationId),
      orderBy: desc(extensionKeys.lastUsedAt),
    }),
  ]);
  return (
    <section className="card space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Poshmark, Depop, Mercari, Facebook Marketplace and Whatnot</h2>
        <p className="mt-1 text-sm text-zinc-600">
          These stores don&apos;t let other apps post for you, so Relistic works through a Chrome extension in your own
          browser. It opens the store&apos;s listing page and fills in the photos, title, description and price. You
          check it and press the store&apos;s Post button. When an item sells somewhere else, it takes the listing down.
        </p>
      </div>

      <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
        {EXTENSION_MARKETPLACES.map((m) => {
          const c = added.find((x) => x.marketplace === m);
          const n = c ? (waiting.get(c.id) ?? 0) : 0;
          return (
            <li key={m} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">{MARKETPLACE_LABELS[m]}</div>
                <div className="text-sm text-zinc-600">
                  {!c
                    ? "Not added."
                    : n > 0
                      ? `Added. ${n} ${n === 1 ? "listing is" : "listings are"} waiting in the extension.`
                      : "Added. Tick it on an item to list it there."}{" "}
                  Stay signed in to{" "}
                  <a href={EXTENSION_SITES[m]} target="_blank" rel="noreferrer" className="underline">
                    {MARKETPLACE_LABELS[m]}
                  </a>{" "}
                  in Chrome.
                </div>
              </div>
              {c ? (
                <form action={disconnectStore.bind(null, c.id)}>
                  <button className="btn-secondary">Remove</button>
                </form>
              ) : (
                <form action={addExtensionStore.bind(null, m)}>
                  <button className="btn">Add {MARKETPLACE_LABELS[m]}</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-3">
        <h3 className="font-semibold">The Relistic extension</h3>
        <p className="text-sm text-zinc-600">
          {lastKey?.lastUsedAt
            ? `An extension last checked in ${ago(lastKey.lastUsedAt)}.`
            : "No extension has checked in yet."}
        </p>
        <ConnectExtension newKey={newExtensionKey} />
        <details className="rounded-md border border-zinc-200 p-4 text-sm">
          <summary className="cursor-pointer font-medium">How to add the extension to Chrome</summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-700">
            <li>
              <a href="/relistic-extension.zip" className="underline">Download the extension</a>. It saves a file
              called relistic-extension.zip.
            </li>
            <li>Open your Downloads folder and double-click the file. A folder called relistic-extension appears.</li>
            <li>
              In Chrome, click in the address bar at the top, type <strong>chrome://extensions</strong> and press Enter.
            </li>
            <li>In the top right corner of that page, turn on the <strong>Developer mode</strong> switch.</li>
            <li>
              Click <strong>Load unpacked</strong> in the top left, choose the relistic-extension folder and click{" "}
              <strong>Select</strong>.
            </li>
            <li>
              Click the puzzle piece icon to the right of the address bar, then the pin next to Relistic, so its icon
              stays in the toolbar.
            </li>
            <li>Come back to this page, reload it, and click <strong>Connect the extension</strong>.</li>
          </ol>
        </details>
      </div>
    </section>
  );
}

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

      <ExtensionStores organizationId={user.organizationId} conns={conns} />
    </div>
  );
}

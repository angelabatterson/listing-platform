import { desc, eq } from "drizzle-orm";
import { ConnectExtension } from "@/components/connect-extension";
import { EbaySettingsForm } from "@/components/ebay-settings-form";
import { EbayStarterPolicies } from "@/components/ebay-starter-policies";
import { EtsySettingsForm } from "@/components/etsy-settings-form";
import { ImportListings } from "@/components/import-listings";
import { db } from "@/db";
import { connections, extensionKeys, type Connection } from "@/db/schema";
import { newExtensionKey } from "@/app/(app)/extension/actions";
import { openTaskCounts } from "@/lib/extension/tasks";
import { EXTENSION_MARKETPLACES, type ExtensionMarketplace } from "@/lib/marketplaces/labels";
import { requireUser } from "@/lib/auth";
import { importedCount } from "@/lib/import";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces";
import { fetchEbayPolicies } from "@/lib/marketplaces/ebay/adapter";
import { ebayEnvironment, ebayHosts, ebayIsConfigured } from "@/lib/marketplaces/ebay/config";
import { fetchEtsyShopOptions } from "@/lib/marketplaces/etsy/adapter";
import { etsyIsConfigured } from "@/lib/marketplaces/etsy/config";
import { shopifyIsConfigured } from "@/lib/marketplaces/shopify/config";
import { DEFAULT_PACKAGE_WEIGHT_LB, tiktokIsConfigured } from "@/lib/marketplaces/tiktok/config";
import { isConnectionReady, storeLabel } from "@/lib/stores";
import { addExtensionStore, createEbayStarterPolicies, disconnectStore, importStorePage, saveEbaySettings, saveEtsySettings, saveTiktokSettings } from "./actions";

const EXTENSION_SITES: Record<ExtensionMarketplace, string> = {
  poshmark: "https://poshmark.com",
  depop: "https://www.depop.com",
  facebook: "https://www.facebook.com/marketplace",
  mercari: "https://www.mercari.com",
  whatnot: "https://www.whatnot.com",
  grailed: "https://www.grailed.com",
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
        <h2 className="text-lg font-semibold">Poshmark, Depop, Mercari, Grailed, Facebook Marketplace and Whatnot</h2>
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
                {c?.settings.chromeSignIn && (
                  <div className={`mt-1 text-sm font-medium ${c.settings.chromeSignIn.signedIn ? "text-green-700" : "text-amber-700"}`}>
                    {c.settings.chromeSignIn.signedIn
                      ? `● Signed in on Chrome (checked ${ago(new Date(c.settings.chromeSignIn.checkedAt))})`
                      : `○ Not signed in on Chrome (checked ${ago(new Date(c.settings.chromeSignIn.checkedAt))}). Open ${MARKETPLACE_LABELS[m]} and sign in.`}
                  </div>
                )}
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
  shopify_shop:
    "Enter your store's Shopify address, like mystore.myshopify.com. You'll find it in Shopify under Settings, then Domains.",
  shopify_declined: "Shopify didn't grant access. Try connecting again and choose Install.",
  shopify_state: "That Shopify sign-in expired or didn't match. Please try again.",
  tiktok_declined: "TikTok Shop didn't grant access. Try connecting again and choose Authorize.",
  tiktok_state: "That TikTok Shop sign-in expired or didn't match. Please try again.",
  tiktok_no_shop: "Relistic couldn't find a TikTok Shop with a shipping warehouse on that account. Check your shop in TikTok Seller Center, then connect again.",
  shopify_no_location: "Relistic couldn't find a location on your Shopify store to keep stock at. Add one in Shopify under Settings, then Locations, and connect again.",
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
        {props.configured && marketplace === "shopify" ? (
          <form action="/api/shopify/oauth/start" className="flex flex-wrap items-center gap-2">
            <input
              name="shop"
              className="input w-56"
              placeholder="mystore.myshopify.com"
              aria-label="Your Shopify store address"
              defaultValue={connection?.settings.shopDomain}
              required
            />
            <button className={connection ? "btn-secondary" : "btn"}>{connection ? "Reconnect" : `Connect ${name}`}</button>
          </form>
        ) : props.configured ? (
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
  const shopify = live("shopify");
  const tiktok = live("tiktok");
  const [ebayPolicies, etsyOptions, ebayImported, etsyImported] = await Promise.all([
    ebay ? load(() => fetchEbayPolicies(ebay)) : undefined,
    etsy?.settings.shopId ? load(() => fetchEtsyShopOptions(etsy)) : undefined,
    ebay ? importedCount(ebay.id) : 0,
    etsy ? importedCount(etsy.id) : 0,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Stores</h1>
      {typeof error === "string" && errors[error] && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">{errors[error]}</p>
      )}
      {(connected === "ebay" || connected === "etsy" || connected === "shopify" || connected === "tiktok") && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
          {connected === "shopify" || connected === "tiktok"
            ? `${MARKETPLACE_LABELS[connected]} connected. Tick it on an item to list it there.`
            : `${MARKETPLACE_LABELS[connected]} connected. Finish the settings below so items can be listed.`}
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
              <EbayStarterPolicies
                action={createEbayStarterPolicies.bind(null, ebay.id)}
                policiesUrl={ebayEnvironment() === "production" ? ebayHosts().policies : undefined}
              />
            )}
            <EbaySettingsForm
              // Remount when the chosen policies change, e.g. after creating starter ones.
              key={[ebay.settings.fulfillmentPolicyId, ebay.settings.paymentPolicyId, ebay.settings.returnPolicyId].join()}
              action={saveEbaySettings.bind(null, ebay.id)}
              policies={ebayPolicies.data}
              settings={ebay.settings}
            />
          </>
        )}
        {ebay?.status === "active" && (
          <ImportListings
            store="eBay"
            imported={ebayImported}
            note="Listings you made on eBay's own website keep their title, photos and description on eBay. Relistic keeps their price and quantity in sync, and takes them down when they sell somewhere else."
            run={importStorePage.bind(null, ebay.id)}
          />
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
        {etsy?.status === "active" && etsy.settings.shopId && (
          <ImportListings store="Etsy" imported={etsyImported} run={importStorePage.bind(null, etsy.id)} />
        )}
      </section>

      <section className="card">
        <StoreHeader connection={shopify} marketplace="shopify" configured={shopifyIsConfigured()} />
        <p className="mt-3 text-sm text-zinc-600">
          Items you list on Shopify become products in your store, with their photos, price and quantity. When one
          sells somewhere else, Relistic lowers its stock, or hides it as a draft when none are left.
        </p>
      </section>

      <section className="card">
        <StoreHeader connection={tiktok} marketplace="tiktok" configured={tiktokIsConfigured()} />
        <p className="mt-3 text-sm text-zinc-600">
          Items you list on TikTok Shop become products in your shop. TikTok checks each new product before it goes
          live. If you don&apos;t enter a TikTok Shop category on an item, Relistic uses the one TikTok suggests for its
          title. When an item sells somewhere else, Relistic lowers its stock, or deactivates it when none are left.
        </p>
        {tiktok?.status === "active" && (
          <form action={saveTiktokSettings.bind(null, tiktok.id)} className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="packageWeightLb">Usual package weight (pounds)</label>
              <input
                id="packageWeightLb"
                name="packageWeightLb"
                type="number"
                step="0.1"
                min="0.1"
                className="input w-40"
                defaultValue={tiktok.settings.packageWeightLb ?? DEFAULT_PACKAGE_WEIGHT_LB}
              />
            </div>
            <button className="btn-secondary">Save</button>
            <p className="w-full text-xs text-zinc-500">TikTok needs a weight on every product. New products use this one.</p>
          </form>
        )}
      </section>

      <ExtensionStores organizationId={user.organizationId} conns={conns} />
    </div>
  );
}

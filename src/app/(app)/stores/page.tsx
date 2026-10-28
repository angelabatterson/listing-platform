import { eq } from "drizzle-orm";
import { EbaySettingsForm } from "@/components/ebay-settings-form";
import { db } from "@/db";
import { connections, type Connection } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fetchEbayPolicies, type EbayPolicies } from "@/lib/marketplaces/ebay/adapter";
import { ebayEnvironment, ebayHosts, ebayIsConfigured } from "@/lib/marketplaces/ebay/config";
import { isConnectionReady, storeLabel } from "@/lib/stores";
import { disconnectStore, saveEbaySettings } from "./actions";

const errors: Record<string, string> = {
  ebay_declined: "eBay didn't grant access. Try connecting again and choose Agree.",
  ebay_state: "That eBay sign-in expired or didn't match. Please try again.",
};

async function loadPolicies(connection: Connection): Promise<{ policies?: EbayPolicies; error?: string }> {
  try {
    return { policies: await fetchEbayPolicies(connection) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't load eBay policies" };
  }
}

export default async function StoresPage(props: PageProps<"/stores">) {
  const { error, connected } = await props.searchParams;
  const user = await requireUser();
  const conns = await db.query.connections.findMany({
    where: eq(connections.organizationId, user.organizationId),
  });
  const ebay = conns.find((c) => c.marketplace === "ebay" && c.status !== "disconnected");
  const ebayPolicies = ebay ? await loadPolicies(ebay) : undefined;
  const hosts = ebayHosts();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Stores</h1>
      {typeof error === "string" && errors[error] && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">{errors[error]}</p>
      )}
      {connected === "ebay" && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
          eBay connected. Finish the settings below so items can be listed.
        </p>
      )}

      <section className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{ebay ? storeLabel(ebay) : "eBay"}</h2>
            <p className="text-sm text-zinc-600">
              {!ebay && "Not connected."}
              {ebay && ebay.status === "needs_reauth" && "eBay sign-in expired. Reconnect to keep syncing."}
              {ebay && ebay.status === "active" && (isConnectionReady(ebay) ? "Connected and ready to list." : "Connected. Settings needed before listing.")}
              {ebayEnvironment() === "sandbox" && " (eBay test environment)"}
            </p>
          </div>
          <div className="flex gap-2">
            {ebayIsConfigured() ? (
              <a href="/api/ebay/oauth/start" className={ebay ? "btn-secondary" : "btn"}>
                {ebay ? "Reconnect" : "Connect eBay"}
              </a>
            ) : (
              <span className="text-sm text-amber-700">eBay keys aren&apos;t set up on the server yet.</span>
            )}
            {ebay && (
              <form action={disconnectStore.bind(null, ebay.id)}>
                <button className="btn-secondary">Disconnect</button>
              </form>
            )}
          </div>
        </div>

        {ebay && ebayPolicies?.error && (
          <p className="mt-4 text-sm text-red-600">
            Couldn&apos;t load your eBay business policies: {ebayPolicies.error}
          </p>
        )}
        {ebay && ebayPolicies?.policies && (
          <>
            {Object.values(ebayPolicies.policies).some((list) => list.length === 0) && (
              <p className="mt-4 text-sm text-amber-700">
                eBay needs a shipping, payment and return policy on your account.{" "}
                <a href={hosts.policies} target="_blank" rel="noreferrer" className="underline">
                  Create them on eBay
                </a>
                , then reload this page.
              </p>
            )}
            <EbaySettingsForm
              action={saveEbaySettings.bind(null, ebay.id)}
              policies={ebayPolicies.policies}
              settings={ebay.settings}
            />
          </>
        )}
      </section>

      <section className="card opacity-70">
        <h2 className="text-lg font-semibold">Etsy</h2>
        <p className="text-sm text-zinc-600">Coming next.</p>
      </section>
    </div>
  );
}

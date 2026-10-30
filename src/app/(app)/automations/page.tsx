import Link from "next/link";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { connections, type Connection } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { storeLabel } from "@/lib/stores";

// What each store's automations do, or what's planned for it.
function summary(c: Connection): { text: string; ready: boolean } {
  if (c.marketplace === "ebay") {
    const a = c.settings.automations;
    const on = [a?.bestOffer?.enabled && "Best Offer", a?.watcherOffers?.enabled && "offers to watchers", a?.relist?.enabled && "relisting"].filter(Boolean);
    return { text: on.length ? `On: ${on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on.at(-1)}` : on[0]}.` : "Best Offer, offers to watchers and relisting. Nothing turned on yet.", ready: true };
  }
  if (c.marketplace === "poshmark" || c.marketplace === "mercari" || c.marketplace === "depop") {
    return { text: "Coming soon: sharing, offers and relisting through the Chrome extension.", ready: false };
  }
  return { text: "No automations for this store yet.", ready: false };
}

export default async function AutomationsPage() {
  const user = await requireUser();
  const stores = await db.query.connections.findMany({
    where: and(eq(connections.organizationId, user.organizationId), ne(connections.status, "disconnected")),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automations</h1>
        <p className="mt-1 text-zinc-600">Things Relistic does for you on each store, so you don&apos;t have to.</p>
      </div>
      {stores.length === 0 ? (
        <p className="text-zinc-600">
          Connect a store on the <Link href="/stores" className="underline">Stores</Link> page first.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {stores.map((c) => {
            const s = summary(c);
            const body = (
              <>
                <h2 className="font-semibold">{storeLabel(c)}</h2>
                <p className="mt-1 text-sm text-zinc-600">{s.text}</p>
              </>
            );
            return s.ready ? (
              <Link key={c.id} href={`/automations/${c.id}`} className="card block hover:border-zinc-400">
                {body}
                <p className="mt-3 text-sm font-medium">Set up &rarr;</p>
              </Link>
            ) : (
              <div key={c.id} className="card opacity-70">{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { EbayAutomationsForm } from "@/components/ebay-automations-form";
import { db } from "@/db";
import { connections, syncEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { storeLabel } from "@/lib/stores";
import { applyEbayBestOffer, saveEbayAutomations } from "../actions";

export default async function StoreAutomationsPage(props: PageProps<"/automations/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  const connection = await db.query.connections.findFirst({
    where: and(eq(connections.id, id), eq(connections.organizationId, user.organizationId)),
  });
  if (!connection || connection.marketplace !== "ebay") notFound();
  const history = await db.query.syncEvents.findMany({
    where: and(eq(syncEvents.connectionId, connection.id), eq(syncEvents.action, "offer to watchers")),
    orderBy: desc(syncEvents.createdAt),
    limit: 20,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/automations" className="text-sm text-zinc-600 hover:underline">&larr; Automations</Link>
        <h1 className="mt-1 text-2xl font-semibold">{storeLabel(connection)}</h1>
      </div>
      <EbayAutomationsForm
        automations={connection.settings.automations ?? {}}
        save={saveEbayAutomations.bind(null, connection.id)}
        apply={applyEbayBestOffer.bind(null, connection.id)}
      />
      <section className="card">
        <h2 className="text-lg font-semibold">Recent offers to watchers</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">None sent yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 text-sm">
            {history.map((e) => (
              <li key={e.id} className="flex gap-4 py-2">
                <span className="whitespace-nowrap text-zinc-500">{e.createdAt.toLocaleString()}</span>
                <span className={e.ok ? "" : "text-red-600"}>{e.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

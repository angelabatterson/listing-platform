import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { syncEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export default async function ActivityPage() {
  const user = await requireUser();
  const events = await db.query.syncEvents.findMany({
    where: eq(syncEvents.organizationId, user.organizationId),
    orderBy: desc(syncEvents.createdAt),
    limit: 200,
  });
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Activity</h1>
      {events.length === 0 ? (
        <p className="text-zinc-600">Nothing has synced yet.</p>
      ) : (
        <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-zinc-100">
                <td className="whitespace-nowrap px-4 py-2 text-zinc-500">{e.createdAt.toLocaleString()}</td>
                <td className="px-4 py-2">{e.action}</td>
                <td className={`px-4 py-2 ${e.ok ? "" : "text-red-600"}`}>{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

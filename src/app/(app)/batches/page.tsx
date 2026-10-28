import { count, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { batches, items, photos } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { createBatch } from "./actions";

export default async function BatchesPage() {
  const user = await requireUser();
  const rows = await db
    .select({
      id: batches.id,
      number: batches.number,
      createdAt: batches.createdAt,
      photoCount: sql<number>`(select ${count()} from ${photos} where ${photos.batchId} = ${batches.id})`.mapWith(Number),
      itemCount: sql<number>`(select ${count()} from ${items} where ${items.batchId} = ${batches.id})`.mapWith(Number),
    })
    .from(batches)
    .where(eq(batches.organizationId, user.organizationId))
    .orderBy(desc(batches.number));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Photo batches</h1>
          <p className="text-sm text-zinc-600">Upload a pile of photos and the AI turns them into draft listings.</p>
        </div>
        <form action={createBatch}>
          <button className="btn">New batch</button>
        </form>
      </div>
      {rows.length === 0 ? (
        <div className="card text-zinc-600">No batches yet. Start one to upload photos.</div>
      ) : (
        <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-4 py-2">Batch</th>
              <th className="px-4 py-2">Started</th>
              <th className="px-4 py-2">Photos</th>
              <th className="px-4 py-2">Items drafted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-zinc-100">
                <td className="px-4 py-2">
                  <Link href={`/batches/${b.id}`} className="font-medium hover:underline">B{b.number}</Link>
                </td>
                <td className="px-4 py-2">{b.createdAt.toLocaleDateString("en-US")}</td>
                <td className="px-4 py-2">{b.photoCount}</td>
                <td className="px-4 py-2">{b.itemCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

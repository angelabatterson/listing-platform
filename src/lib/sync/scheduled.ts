import "server-only";
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { items, syncEvents, users } from "@/db/schema";
import { listingProblem } from "@/lib/billing/access";
import { postingProblems } from "@/lib/review";
import { syncItem } from "./run";

// How many scheduled drafts one cron run posts, so a big batch doesn't time out.
export const SCHEDULED_PER_RUN = 25;

// Post the drafts whose scheduled time has come. A draft that can't go up (a store
// problem, or the plan's listing limit) is taken off the schedule and noted in Activity.
// Extension stores (Poshmark and the like) get a waiting task, the same as posting by hand.
export async function postScheduledDrafts(now = new Date()) {
  const due = await db
    .select({ id: items.id, organizationId: items.organizationId })
    .from(items)
    .where(and(eq(items.status, "draft"), isNotNull(items.scheduledAt), lte(items.scheduledAt, now)))
    .orderBy(asc(items.scheduledAt))
    .limit(SCHEDULED_PER_RUN);

  let posted = 0;
  let failed = 0;
  for (const { id, organizationId } of due) {
    // Claim it first, so two overlapping runs can't post the same draft.
    const [claimed] = await db
      .update(items)
      .set({ scheduledAt: null })
      .where(and(eq(items.id, id), eq(items.status, "draft"), isNotNull(items.scheduledAt)))
      .returning({ id: items.id });
    if (!claimed) continue;
    try {
      const problem = await whyNot(organizationId, id);
      if (problem) {
        failed++;
        await db.insert(syncEvents).values({
          organizationId,
          itemId: id,
          action: "scheduled_post",
          ok: false,
          message: `The scheduled post didn't go up: ${problem} Fix it, then post or schedule it again.`,
        });
        continue;
      }
      await db.update(items).set({ status: "active" }).where(eq(items.id, id));
      await syncItem(organizationId, id);
      posted++;
    } catch (err) {
      failed++;
      console.error("Scheduled post failed", id, err);
    }
  }
  return { due: due.length, posted, failed };
}

async function whyNot(organizationId: string, itemId: string): Promise<string | null> {
  const item = await db.query.items.findFirst({
    where: and(eq(items.id, itemId), eq(items.organizationId, organizationId)),
    with: { images: true, listings: { with: { connection: true } } },
  });
  if (!item) return "the item is gone.";
  const problems = postingProblems(item);
  if (problems.length) return problems.join(" ");
  // The listing limit belongs to the account; any of its people with room will do.
  const people = await db.query.users.findMany({ where: eq(users.organizationId, organizationId), orderBy: asc(users.createdAt) });
  let limit: string | null = "no one is signed up on this account.";
  for (const u of people) {
    limit = await listingProblem({ id: u.id, email: u.email, name: u.name, organizationId });
    if (!limit) break;
  }
  return limit;
}

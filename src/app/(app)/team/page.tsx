import { and, asc, eq, gt } from "drizzle-orm";
import { HelperRow, InviteForm, PendingInvite } from "@/components/team-forms";
import { db } from "@/db";
import { teamInvites, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/billing/access";
import { teamLimitMessage } from "@/lib/billing/plans";

export default async function TeamPage() {
  const user = await requireUser("owner");
  const [access, helpers, invites] = await Promise.all([
    getAccess(user),
    db.query.users.findMany({
      where: and(eq(users.organizationId, user.organizationId), eq(users.role, "helper")),
      columns: { id: true, name: true, email: true, pages: true },
      orderBy: asc(users.createdAt),
    }),
    db.query.teamInvites.findMany({
      where: and(eq(teamInvites.organizationId, user.organizationId), gt(teamInvites.expiresAt, new Date())),
      orderBy: asc(teamInvites.createdAt),
    }),
  ]);
  const seats = access.limits.teamSeats;
  const used = helpers.length + invites.length;
  const blocked = seats !== null && used >= seats ? teamLimitMessage(access) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Give helpers their own login. They only see the pages you tick, and never Stores, Billing or this page.
          {seats !== null && ` Your plan includes ${seats} team ${seats === 1 ? "login" : "logins"}; ${used} in use.`}
        </p>
      </div>

      <InviteForm blocked={blocked} />

      {invites.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-semibold">Waiting to join</h2>
          <ul className="divide-y divide-zinc-100">
            {invites.map((i) => (
              <PendingInvite key={i.id} id={i.id} email={i.email} expires={i.expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="text-lg font-semibold">Helpers</h2>
        {helpers.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No helpers yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {helpers.map((h) => (
              <HelperRow key={h.id} id={h.id} label={h.name || h.email} email={h.email} pages={h.pages} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

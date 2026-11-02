import { eq } from "drizzle-orm";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { findInvite } from "@/lib/team-invites";
import { acceptInvite } from "../../actions";

// Where an invite link lands: the helper picks their name and password.
export default async function JoinPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const invite = await findInvite(token);
  if (!invite) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold">This invite link doesn&apos;t work</h1>
        <p className="text-sm text-zinc-600">
          It has expired, was already used, or was cancelled. Ask the person who invited you for a new link.
        </p>
        <Link href="/login" className="text-sm font-medium underline">Log in</Link>
      </main>
    );
  }
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, invite.organizationId),
    columns: { name: true },
  });
  return (
    <AuthForm
      title={`Join ${org?.name ?? "the team"} on Relistic`}
      intro={`You're setting up a login for ${invite.email}. You'll use this email and password to log in.`}
      submitLabel="Join the team"
      action={acceptInvite.bind(null, token)}
      fields={[
        { name: "name", label: "Your name", autoComplete: "name" },
        { name: "password", label: "Password (10+ characters)", type: "password", autoComplete: "new-password" },
      ]}
    />
  );
}

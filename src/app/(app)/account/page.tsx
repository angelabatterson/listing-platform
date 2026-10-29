import { eq } from "drizzle-orm";
import { SettingsForm } from "@/components/settings-form";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { changeEmail, changePassword, saveProfile } from "./actions";

export default async function AccountPage() {
  const user = await requireUser();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, user.organizationId),
    columns: { name: true },
  });

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Account settings</h1>
      <SettingsForm
        title="Your details"
        submitLabel="Save"
        action={saveProfile}
        fields={[
          { name: "businessName", label: "Business name", autoComplete: "organization", defaultValue: org?.name },
          { name: "name", label: "Your name", autoComplete: "name", defaultValue: user.name ?? "", required: false },
        ]}
      />
      <SettingsForm
        title="Email"
        submitLabel="Change email"
        action={changeEmail}
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email", defaultValue: user.email },
          { name: "password", label: "Current password", type: "password", autoComplete: "current-password" },
        ]}
      />
      <SettingsForm
        title="Password"
        submitLabel="Change password"
        action={changePassword}
        fields={[
          { name: "current", label: "Current password", type: "password", autoComplete: "current-password" },
          { name: "password", label: "New password (10+ characters)", type: "password", autoComplete: "new-password" },
          { name: "confirm", label: "New password again", type: "password", autoComplete: "new-password" },
        ]}
      />
    </div>
  );
}

import { eq } from "drizzle-orm";
import Link from "next/link";
import { DraftSettingsForm } from "@/components/draft-settings-form";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { titleOrder } from "@/lib/ai/title-order";
import { requireUser } from "@/lib/auth";

export default async function DraftSettingsPage() {
  const user = await requireUser();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, user.organizationId),
    columns: { draftSettings: true },
  });
  const settings = org?.draftSettings ?? {};
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/batches" className="text-sm text-zinc-600 hover:underline">← Photo batches</Link>
        <h1 className="text-2xl font-semibold">Draft settings</h1>
        <p className="text-sm text-zinc-600">How the AI writes listings from your photos. Changes apply to drafts written from now on.</p>
      </div>
      <DraftSettingsForm titleOrder={titleOrder(settings.titleOrder)} skuFromPhoto={settings.skuFromPhoto !== false} />
    </div>
  );
}

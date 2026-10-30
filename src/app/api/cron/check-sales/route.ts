import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runEbayAutomations } from "@/lib/automations/ebay";
import { moveDatabasePhotosToFiles, removeOrphanPhotoFiles } from "@/lib/photos/store";
import { checkAllStoresForSales } from "@/lib/sync/sales";

// Called on a schedule (see vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await checkAllStoresForSales();
  // Photo housekeeping rides along; a problem here never fails the sales check.
  const photos = await Promise.all([moveDatabasePhotosToFiles(), removeOrphanPhotoFiles()])
    .then(([moved, removed]) => ({ moved, removed }))
    .catch((err: unknown) => {
      console.error("Photo housekeeping failed", err);
      return { error: true };
    });
  const automations = await runEbayAutomations().catch((err: unknown) => {
    console.error("Automations failed", err);
    return { error: true };
  });
  return NextResponse.json({ checked: results.length, results, photos, automations });
}

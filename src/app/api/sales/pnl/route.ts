import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { pnlPdf, summarizeYear } from "@/lib/pnl";
import { allSales } from "@/lib/sales-table";
import { storeLabel } from "@/lib/stores";
import { canUse } from "@/lib/team";

// The year-end profit and loss PDF for ?year=2026.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please log in again.", { status: 401 });
  if (!canUse(user, "sales")) return new Response("Not allowed", { status: 403 });
  const thisYear = new Date().getUTCFullYear();
  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > thisYear) return new Response("Pick a year to download.", { status: 400 });

  const [rows, org] = await Promise.all([
    allSales(user.organizationId, { q: "", store: "", period: "custom", from: `${year}-01-01`, to: `${year}-12-31`, page: 1 }, 100_000),
    db.query.organizations.findFirst({ where: eq(organizations.id, user.organizationId), columns: { name: true } }),
  ]);
  const pnl = summarizeYear(
    year,
    rows.map((r) => ({ soldAt: r.sale.soldAt, store: storeLabel(r.store), money: r.money })),
  );
  const pdf = await pnlPdf(pnl, org?.name || "Your business");
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="relistic-profit-and-loss-${year}.pdf"`,
    },
  });
}

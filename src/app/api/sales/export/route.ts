import { getCurrentUser } from "@/lib/auth";
import { canUse } from "@/lib/team";
import { toCsv } from "@/lib/csv";
import { periodRange, rangeSlug } from "@/lib/periods";
import { allSales, parseSalesFilters, salesCsvRows } from "@/lib/sales-table";

// The Sales page (with its search, store and dates) as a spreadsheet. The same file can
// be edited and uploaded again on the Sales page.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please log in again.", { status: 401 });
  if (!canUse(user, "sales")) return new Response("Not allowed", { status: 403 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const f = parseSalesFilters(params);
  const rows = await allSales(user.organizationId, f);
  const when = f.period === "all" ? new Date().toISOString().slice(0, 10) : rangeSlug(periodRange(f.period, f.from, f.to));
  return new Response(toCsv(salesCsvRows(rows)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relistic-sales-${when}.csv"`,
    },
  });
}

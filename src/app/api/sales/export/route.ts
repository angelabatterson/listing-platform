import { getCurrentUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { allSales, parseSalesFilters, salesCsvRows } from "@/lib/sales-table";

// The Sales page (with its search and store filter) as a spreadsheet. The same file can
// be edited and uploaded again on the Sales page.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please log in again.", { status: 401 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const rows = await allSales(user.organizationId, parseSalesFilters(params));
  return new Response(toCsv(salesCsvRows(rows)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relistic-sales-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

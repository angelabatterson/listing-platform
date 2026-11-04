// Time periods for the Sales page and its downloads. Dates are calendar days in UTC.

export const PERIODS = {
  all: "All time",
  today: "Today",
  "7d": "Last 7 days",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-year": "Last year",
  custom: "Custom dates",
} as const;
export type Period = keyof typeof PERIODS;

export function isPeriod(v: unknown): v is Period {
  return typeof v === "string" && Object.hasOwn(PERIODS, v);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

// The [start, end) range a period covers; open-ended when a side is missing.
export function periodRange(period: Period, from: string, to: string, now = new Date()): { start?: Date; end?: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  switch (period) {
    case "today":
      return { start: utcDay(y, m, d), end: utcDay(y, m, d + 1) };
    case "7d":
      return { start: utcDay(y, m, d - 6), end: utcDay(y, m, d + 1) };
    case "this-month":
      return { start: utcDay(y, m, 1), end: utcDay(y, m + 1, 1) };
    case "last-month":
      return { start: utcDay(y, m - 1, 1), end: utcDay(y, m, 1) };
    case "this-year":
      return { start: utcDay(y, 0, 1), end: utcDay(y + 1, 0, 1) };
    case "last-year":
      return { start: utcDay(y - 1, 0, 1), end: utcDay(y, 0, 1) };
    case "custom": {
      const start = isDay(from) ? new Date(`${from}T00:00:00Z`) : undefined;
      const last = isDay(to) ? new Date(`${to}T00:00:00Z`) : undefined;
      return { start, end: last ? utcDay(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() + 1) : undefined };
    }
    default:
      return {};
  }
}

// "Jan 1, 2026 to Mar 31, 2026" style wording for a range, for headings and file names.
export function rangeSlug(range: { start?: Date; end?: Date }): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (!range.start && !range.end) return "all-time";
  const lastDay = range.end ? new Date(range.end.getTime() - 86_400_000) : undefined;
  return `${range.start ? day(range.start) : "start"}-to-${lastDay ? day(lastDay) : "today"}`;
}

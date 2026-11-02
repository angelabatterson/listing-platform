// The pages a helper (a team login) can be given. Owners always see everything;
// Stores, Billing, Account closing and the Team page are owner-only.
export const TEAM_PAGES = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "crm", label: "CRM", href: "/crm" },
  { key: "items", label: "Inventory and the Chrome extension", href: "/items" },
  { key: "sales", label: "Sales", href: "/sales" },
  { key: "batches", label: "Photo batches", href: "/batches" },
  { key: "automations", label: "Automations", href: "/automations" },
  { key: "activity", label: "Activity", href: "/activity" },
  { key: "shipping", label: "Shipping labels", href: "/shipping" },
] as const;

export type TeamPage = (typeof TEAM_PAGES)[number]["key"];
// What a page or action needs: one of the pages above, or the account owner.
export type Area = TeamPage | "owner";

export const INVITE_DAYS = 7;

export function isTeamPage(value: unknown): value is TeamPage {
  return TEAM_PAGES.some((p) => p.key === value);
}

// Only known page keys, each once, in menu order.
export function cleanPages(values: unknown[]): TeamPage[] {
  return TEAM_PAGES.map((p) => p.key).filter((k) => values.includes(k));
}

type Member = { role?: string | null; pages?: string[] | null };

// Users from before team logins (and test stubs) carry no role: they're owners.
export const isHelper = (user: Member) => user.role === "helper";

export function canUse(user: Member, area: Area): boolean {
  if (!isHelper(user)) return true;
  return area !== "owner" && (user.pages ?? []).includes(area);
}

// Where a helper lands when they open a page they can't use.
export function homeFor(user: Member): string {
  if (!isHelper(user)) return "/dashboard";
  return TEAM_PAGES.find((p) => (user.pages ?? []).includes(p.key))?.href ?? "/account";
}

// A store's price rule: the main price raised or lowered by a percentage, then rounded,
// like "Poshmark +10%, end in .99". A price typed for one item on one store still wins.
export type PriceRule = { percent: number; round: "none" | "99" | "whole" };

export const ROUNDING: Record<PriceRule["round"], string> = {
  none: "Leave the cents",
  "99": "End in .99",
  whole: "Whole dollars",
};

export const hasRule = (rule: PriceRule | undefined): rule is PriceRule =>
  Boolean(rule && (rule.percent !== 0 || rule.round !== "none"));

export function applyPriceRule(cents: number, rule: PriceRule | undefined): number {
  if (!hasRule(rule)) return cents;
  const raised = Math.round(cents * (1 + rule.percent / 100));
  const rounded =
    rule.round === "99" ? Math.floor(raised / 100) * 100 + 99 : rule.round === "whole" ? Math.round(raised / 100) * 100 : raised;
  return Math.max(1, rounded);
}

export function describeRule(rule: PriceRule | undefined): string {
  if (!hasRule(rule)) return "Same as the main price";
  const parts = [];
  if (rule.percent) parts.push(`${rule.percent > 0 ? "+" : ""}${rule.percent}%`);
  if (rule.round !== "none") parts.push(ROUNDING[rule.round].toLowerCase());
  return parts.join(", ");
}

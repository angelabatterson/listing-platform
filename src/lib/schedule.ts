// When each scheduled draft goes up, worked out in the seller's own time zone (this runs
// in the browser). "All at once" puts every draft at the start time; "spread out" posts
// `perDay` a day, evenly spaced between two hours of the day, from the start time on.
export type SchedulePlan = {
  start: Date;
  mode: "once" | "spread";
  perDay: number;
  fromHour: number;
  toHour: number;
};

export function scheduleTimes(count: number, plan: SchedulePlan): Date[] {
  if (count <= 0) return [];
  if (plan.mode === "once") return Array.from({ length: count }, () => new Date(plan.start));
  const perDay = Math.max(1, Math.min(200, Math.floor(plan.perDay)));
  const fromHour = Math.max(0, Math.min(23, plan.fromHour));
  const toHour = Math.max(fromHour + 1, Math.min(24, plan.toHour));
  const gapMinutes = ((toHour - fromHour) * 60) / perDay;
  const times: Date[] = [];
  const day = new Date(plan.start.getFullYear(), plan.start.getMonth(), plan.start.getDate());
  for (let d = 0; times.length < count && d < 3660; d++) {
    for (let i = 0; i < perDay && times.length < count; i++) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + d, fromHour, Math.round(i * gapMinutes));
      if (at >= plan.start) times.push(at);
    }
  }
  return times;
}

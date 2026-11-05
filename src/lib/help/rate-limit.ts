// A simple per-user limit on Penny questions, kept in memory (the app runs as one
// process on cPanel, and a restart just resets the counts).
export const QUESTIONS_PER_HOUR = 40;
const HOUR = 60 * 60 * 1000;
const asked = new Map<string, number[]>();

export function takeQuestion(userId: string, now = Date.now()): boolean {
  const recent = (asked.get(userId) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= QUESTIONS_PER_HOUR) {
    asked.set(userId, recent);
    return false;
  }
  recent.push(now);
  asked.set(userId, recent);
  return true;
}

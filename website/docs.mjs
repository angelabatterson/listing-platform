// The help articles and their front matter, shared by build.mjs (the help center) and
// scripts/build-help-index.mjs (what Penny, the in-app assistant, knows).
import { readFileSync } from "node:fs";

// Help articles, in sidebar order.
export const DOC_GROUPS = [
  ["Start here", ["getting-started", "install-app", "connect-stores", "chrome-extension"]],
  ["Listing", ["add-items", "photo-batches", "bulk-crosslist", "import-listings", "organize-inventory"]],
  ["Selling", ["sales-sync", "sales-profit", "shipping-labels", "automations", "dashboard-crm"]],
  ["Your account", ["team-logins", "billing-account", "faq"]],
];

export function read(path) {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^<!--\n([\s\S]*?)\n-->\n/);
  if (!m) throw new Error(`${path}: missing front matter`);
  const meta = Object.fromEntries(
    m[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return { ...meta, body: raw.slice(m[0].length) };
}

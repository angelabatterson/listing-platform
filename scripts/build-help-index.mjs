// Turns the help center articles (website/docs) into src/lib/help/articles.json, the
// guide text Penny, the in-app help assistant, answers from. Run it after changing a guide:
//   node scripts/build-help-index.mjs
// (tests/help-index.test.ts fails if the JSON is out of date.)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_GROUPS, read } from "../website/docs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = "https://doc.getrelistic.com";
const APP = "https://app.getrelistic.com";
const SITE = "https://getrelistic.com";

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&rarr;": "→" };

// Plain text with light markdown (headings, list markers), which the model reads well.
export function htmlToText(html) {
  let s = html
    .replaceAll("{{APP}}", APP)
    .replaceAll("{{SITE}}", SITE)
    .replaceAll("{{DOCS}}", DOCS)
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<\/h[23]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(tr)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/(p|div|ol|ul|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  for (const [k, v] of Object.entries(ENTITIES)) s = s.replaceAll(k, v);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{2,}- /g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildIndex() {
  return DOC_GROUPS.flatMap(([group, slugs]) =>
    slugs.map((slug) => {
      const a = read(join(root, "website", "docs", `${slug}.html`));
      return { slug, group, title: a.title, description: a.description, url: `${DOCS}/${slug}/`, text: htmlToText(a.body) };
    }),
  );
}

export const INDEX_PATH = join(root, "src", "lib", "help", "articles.json");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(INDEX_PATH, JSON.stringify(buildIndex(), null, 2) + "\n");
  console.log(`Wrote ${INDEX_PATH}`);
}

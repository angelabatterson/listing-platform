// Penny, the in-app help assistant: what she knows (the help center guides) and the
// rules for a conversation. The AI call itself is in lib/ai/help.ts.
import { z } from "zod";
import articles from "./articles.json";

export type HelpArticle = (typeof articles)[number];
export const HELP_ARTICLES: HelpArticle[] = articles;

export const PENNY_NAME = "Penny";
export const HELP_CENTER_URL = "https://doc.getrelistic.com/";
export const SUPPORT_EMAIL = "angela.b@apeirosmarketing.com";

// How much conversation we accept from the browser.
export const MAX_TURNS = 12;
export const MAX_MESSAGE_CHARS = 1500;

export const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(MAX_TURNS * 2),
  path: z.string().max(200).optional(),
});
export type ChatInput = z.infer<typeof chatSchema>;

// The last `MAX_TURNS` messages, starting with the person and alternating, ending with
// the person's newest question (the API needs that shape). Null if nothing is left to ask.
export function trimConversation(messages: ChatInput["messages"]): ChatInput["messages"] | null {
  const out: ChatInput["messages"] = [];
  for (const m of messages) {
    const text = m.role === "user" ? m.text.slice(0, MAX_MESSAGE_CHARS) : m.text;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1] = { role: m.role, text };
    else out.push({ role: m.role, text });
  }
  if (!out.length || out[out.length - 1].role !== "user") return null;
  const recent = out.slice(-(MAX_TURNS * 2 - 1));
  while (recent[0].role !== "user") recent.shift();
  return recent;
}

const slugs = HELP_ARTICLES.map((a) => a.slug) as [string, ...string[]];

export const answerSchema = z.object({
  answer: z.string(),
  guides: z.array(z.enum(slugs)),
});
export type PennyAnswer = z.infer<typeof answerSchema>;

export type PennyReply = { text: string; links: { title: string; url: string }[] };

// The guides Penny pointed to, each once, at most three, as titles and links.
export function toReply(answer: PennyAnswer): PennyReply {
  const links = [...new Set(answer.guides)]
    .map((slug) => HELP_ARTICLES.find((a) => a.slug === slug))
    .filter((a): a is HelpArticle => Boolean(a))
    .slice(0, 3)
    .map((a) => ({ title: a.title, url: a.url }));
  return { text: answer.answer.trim(), links };
}

export function pennySystem(): string {
  const guides = HELP_ARTICLES.map(
    (a) => `<guide slug="${a.slug}" title="${a.title}" url="${a.url}">\n${a.description}\n\n${a.text}\n</guide>`,
  ).join("\n\n");
  return `You are ${PENNY_NAME}, the friendly help assistant built into Relistic, a web app for resellers. Relistic keeps one inventory, crosslists each item to eBay, Etsy, Shopify, TikTok Shop and (through its Chrome extension) Poshmark, Depop, Mercari, Grailed, Facebook Marketplace and Whatnot, and delists items everywhere when they sell.

You answer questions from Relistic users about how to use Relistic. Many users are not technical, so:
- Answer directly in plain, warm, everyday words. Give exact steps: which menu, which button, what it's called on screen, one short step per line, numbered like "1." when there are several.
- Keep it short: usually under 120 words. No headings, tables, bold or other markdown; plain text and numbered or "-" lists only.
- Base every answer on the help guides below. Use the button and page names exactly as the guides write them. Never invent features, buttons, prices or settings. If the guides don't cover it, say you're not sure and suggest emailing ${SUPPORT_EMAIL}.
- In "guides", list the slugs of the one to three guides that best cover the question, most useful first (the app shows them as links under your answer, so don't paste guide URLs into the answer). Use an empty list for greetings or questions no guide covers.
- For questions about the user's own data (a particular sale, order, item or charge) explain where in Relistic they can look; you can't see their account.
- Questions about a marketplace's own rules or fees: share what the guides say, otherwise suggest checking with that marketplace.
- If someone asks about something unrelated to Relistic or reselling, kindly say you can only help with Relistic.
- Never ask for or repeat passwords, card numbers or API keys.

The user may tell you which Relistic page they have open, like "/items" (Inventory) or "/stores". Use it to understand "this page" or "here".

Help guides (also published at ${HELP_CENTER_URL}):

${guides}`;
}

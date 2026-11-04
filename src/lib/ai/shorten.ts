import "server-only";
import { z } from "zod";
import { cutTitle } from "@/lib/marketplaces/cut-title";
import { aiIsConfigured, askForJson } from "./client";

const schema = z.object({ title: z.string() });

// A shorter title that keeps the words buyers search for. Without the AI (or if it
// fails) the title is cut at the last whole word that fits.
export async function shortenTitle(title: string, max: number): Promise<string> {
  if (title.length <= max) return title;
  if (!aiIsConfigured()) return cutTitle(title, max);
  try {
    const answer = await askForJson({
      schema,
      system: `You shorten marketplace listing titles. Return the title rewritten to at most ${max} characters. Keep the brand, what the item is, size, colour, and the other words buyers search for, in the same order. Drop filler and repeated words first. No ALL CAPS, emoji, or new facts.`,
      content: [{ type: "text", text: title }],
      effort: "low",
      maxTokens: 2000,
    });
    return cutTitle(answer.title || title, max);
  } catch {
    return cutTitle(title, max);
  }
}

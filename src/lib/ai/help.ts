import "server-only";
import { answerSchema, pennySystem, toReply, type ChatInput, type PennyReply } from "@/lib/help/penny";
import { askForJson } from "./client";

// Penny's answer to the newest question in `messages` (already trimmed by
// trimConversation). The guides go in a cached system prompt, so follow-up questions
// cost little.
export async function askPenny(messages: ChatInput["messages"], path?: string): Promise<PennyReply> {
  const last = messages.length - 1;
  const answer = await askForJson({
    schema: answerSchema,
    system: pennySystem(),
    cacheSystem: true,
    messages: messages.map((m, i) => ({
      role: m.role,
      content: i === last && path ? `(I'm on the ${path} page.)\n\n${m.text}` : m.text,
    })),
    effort: "low",
    maxTokens: 4000,
    refusal: "Sorry, I can't help with that one. I can answer questions about using Relistic.",
  });
  return toReply(answer);
}

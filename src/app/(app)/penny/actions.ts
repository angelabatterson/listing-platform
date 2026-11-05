"use server";

import { requireUser } from "@/lib/auth";
import { AiError, aiIsConfigured } from "@/lib/ai/client";
import { askPenny } from "@/lib/ai/help";
import { chatSchema, SUPPORT_EMAIL, trimConversation, type PennyReply } from "@/lib/help/penny";
import { takeQuestion } from "@/lib/help/rate-limit";

export type PennyResult = { ok: true; reply: PennyReply } | { ok: false; error: string };

// One question to Penny, with the conversation so far. Every signed-in user (helpers
// too) can ask; nothing is saved.
export async function askPennyAction(input: unknown): Promise<PennyResult> {
  const user = await requireUser();
  const parsed = chatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That message is too long. Try a shorter question." };
  const messages = trimConversation(parsed.data.messages);
  if (!messages) return { ok: false, error: "Type a question first." };
  if (!aiIsConfigured()) {
    return { ok: false, error: `Penny isn't switched on yet. For help, email ${SUPPORT_EMAIL}.` };
  }
  if (!takeQuestion(user.id)) {
    return { ok: false, error: "You've asked a lot of questions in the last hour. Please try again in a few minutes." };
  }
  try {
    return { ok: true, reply: await askPenny(messages, parsed.data.path) };
  } catch (err) {
    console.error("Penny failed", err);
    const error = err instanceof AiError ? err.message : "Penny couldn't answer just now. Please try again.";
    return { ok: false, error };
  }
}

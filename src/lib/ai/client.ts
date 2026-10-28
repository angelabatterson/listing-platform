import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";

export const AI_MODEL = "claude-opus-5-5";

export function aiIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export class AiError extends Error {}

export function jpegBlock(bytes: Buffer): BetaContentBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: bytes.toString("base64") } };
}

// One request that must come back as JSON matching `schema`. If the model declines,
// `fallbacks: "default"` retries on Anthropic's recommended fallback model; a refusal
// that still comes back means every model declined.
export async function askForJson<S extends z.ZodType>(options: {
  schema: S;
  system: string;
  content: BetaContentBlockParam[];
  effort: "low" | "medium" | "high";
  maxTokens: number;
}): Promise<z.infer<S>> {
  if (!aiIsConfigured()) throw new AiError("The AI assistant isn't set up yet (ANTHROPIC_API_KEY is missing).");

  const response = await anthropic().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: options.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: options.effort, format: betaZodOutputFormat(options.schema) },
    system: options.system,
    messages: [{ role: "user", content: options.content }],
  });

  if (response.stop_reason === "refusal") {
    throw new AiError("The AI declined to describe these photos. Fill this one in by hand.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AiError("The AI's answer was cut off. Try again.");
  }
  return response.parsed_output;
}

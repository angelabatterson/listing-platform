import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex, htmlToText, INDEX_PATH } from "../scripts/build-help-index.mjs";
import { answerSchema, HELP_ARTICLES, MAX_TURNS, pennySystem, toReply, trimConversation } from "@/lib/help/penny";
import { QUESTIONS_PER_HOUR, takeQuestion } from "@/lib/help/rate-limit";

describe("Penny's help guides", () => {
  it("match the help center (run node scripts/build-help-index.mjs after editing website/docs)", () => {
    expect(JSON.parse(readFileSync(INDEX_PATH, "utf8"))).toEqual(buildIndex());
  });

  it("turns guide HTML into plain text with real links", () => {
    expect(
      htmlToText('<h2>Step 1</h2>\n<ol>\n  <li>Go to <a href="{{APP}}/stores">Stores</a> &amp; click <strong>Add</strong>.</li>\n  <li>Done</li>\n</ol>'),
    ).toBe("## Step 1\n- Go to Stores & click Add.\n- Done");
  });

  it("puts every guide in the system prompt", () => {
    const system = pennySystem();
    for (const a of HELP_ARTICLES) expect(system).toContain(`url="https://doc.getrelistic.com/${a.slug}/"`);
    expect(system).not.toContain("{{");
  });
});

describe("Penny's answers", () => {
  it("only links real guides, each once, at most three", () => {
    expect(() => answerSchema.parse({ answer: "x", guides: ["made-up"] })).toThrow();
    const reply = toReply({
      answer: " Click Stores. ",
      guides: ["connect-stores", "connect-stores", "faq", "add-items", "billing-account"],
    });
    expect(reply.text).toBe("Click Stores.");
    expect(reply.links.map((l) => l.url)).toEqual([
      "https://doc.getrelistic.com/connect-stores/",
      "https://doc.getrelistic.com/faq/",
      "https://doc.getrelistic.com/add-items/",
    ]);
  });
});

describe("conversation trimming", () => {
  it("needs a question from the person last", () => {
    expect(trimConversation([{ role: "assistant", text: "Hi" }])).toBeNull();
    expect(trimConversation([{ role: "user", text: "a" }, { role: "assistant", text: "b" }])).toBeNull();
  });

  it("merges repeats, starts with the person and keeps the latest turns", () => {
    expect(
      trimConversation([
        { role: "assistant", text: "Hi" },
        { role: "user", text: "first" },
        { role: "user", text: "second" },
      ]),
    ).toEqual([{ role: "user", text: "second" }]);

    const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }) as const);
    const trimmed = trimConversation([...long, { role: "user", text: "last" }])!;
    expect(trimmed.length).toBeLessThan(MAX_TURNS * 2);
    expect(trimmed[0].role).toBe("user");
    expect(trimmed.at(-1)).toEqual({ role: "user", text: "last" });
  });
});

describe("question limit", () => {
  it("allows a set number of questions an hour per person", () => {
    const now = 1_000_000;
    for (let i = 0; i < QUESTIONS_PER_HOUR; i++) expect(takeQuestion("u1", now)).toBe(true);
    expect(takeQuestion("u1", now)).toBe(false);
    expect(takeQuestion("u2", now)).toBe(true);
    expect(takeQuestion("u1", now + 60 * 60 * 1000)).toBe(true);
  });
});

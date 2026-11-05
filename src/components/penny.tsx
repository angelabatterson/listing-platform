"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { askPennyAction } from "@/app/(app)/penny/actions";
import type { PennyReply } from "@/lib/help/penny";

type Message = { role: "user"; text: string } | { role: "assistant"; text: string; links: PennyReply["links"]; error?: boolean };

const STARTERS = [
  "How do I connect my eBay store?",
  "How do I list one item on several stores?",
  "What happens when an item sells?",
  "How do I add Relistic to my phone?",
];

const GREETING =
  "Hi, I'm Penny! Ask me anything about using Relistic, like how to list an item or connect a store. I'll answer or point you to the right help guide.";

// Penny's mark: AI sparkles on a dark circle.
export function PennyIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M10 3.5c.3 0 .5.2.6.5l1 3.3a4 4 0 0 0 2.6 2.6l3.3 1c.6.2.6 1 0 1.2l-3.3 1a4 4 0 0 0-2.6 2.6l-1 3.3c-.2.6-1 .6-1.2 0l-1-3.3a4 4 0 0 0-2.6-2.6l-3.3-1c-.6-.2-.6-1 0-1.2l3.3-1a4 4 0 0 0 2.6-2.6l1-3.3c.1-.3.3-.5.6-.5Z" />
      <path d="M18 2c.2 0 .3.1.4.3l.4 1.2c.1.4.4.7.8.8l1.2.4c.4.1.4.6 0 .8l-1.2.4a1.3 1.3 0 0 0-.8.8l-.4 1.2c-.1.4-.6.4-.8 0l-.4-1.2a1.3 1.3 0 0 0-.8-.8L15.2 5.5c-.4-.1-.4-.6 0-.8l1.2-.4c.4-.1.7-.4.8-.8l.4-1.2c.1-.2.2-.3.4-.3Z" />
    </svg>
  );
}

function Avatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white">
      <PennyIcon className="h-4.5 w-4.5" />
    </span>
  );
}

// The "Ask Penny" button in the corner of every page, and the chat it opens.
export function Penny() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    const next: Message[] = [...messages, { role: "user", text }];
    setMessages(next);
    setDraft("");
    startTransition(async () => {
      // Failed answers aren't sent back as conversation.
      const history = next
        .filter((m) => m.role === "user" || !m.error)
        .map((m) => ({ role: m.role, text: m.text }));
      let result;
      try {
        result = await askPennyAction({ messages: history, path: pathname });
      } catch {
        result = { ok: false as const, error: "Penny couldn't be reached. Check your internet connection and try again." };
      }
      setMessages((m) => [
        ...m,
        result.ok
          ? { role: "assistant", text: result.reply.text, links: result.reply.links }
          : { role: "assistant", text: result.error, links: [], error: true },
      ]);
    });
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-zinc-900 py-2.5 pl-3 pr-4 text-sm font-medium text-white shadow-lg hover:bg-zinc-700 print:hidden"
          aria-label="Ask Penny, the Relistic help assistant"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-400">
            <PennyIcon className="h-4 w-4" />
          </span>
          Ask Penny
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="Penny, the Relistic help assistant"
          className="fixed inset-x-2 bottom-2 top-16 z-50 flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:top-auto sm:h-[min(600px,calc(100vh-2rem))] sm:w-96 print:hidden"
        >
          <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
            <Avatar />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Penny</p>
              <p className="text-xs text-zinc-500">Relistic&apos;s AI help assistant</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={() => setMessages([])} className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
                New chat
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-5 w-5">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm" aria-live="polite">
            <div className="flex gap-2">
              <Avatar />
              <p className="rounded-lg rounded-tl-none bg-zinc-100 px-3 py-2">{GREETING}</p>
            </div>
            {messages.length === 0 && (
              <div className="flex flex-col items-start gap-2 pl-10">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-zinc-300 px-3 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-50">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <p key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-zinc-900 px-3 py-2 text-white">
                  {m.text}
                </p>
              ) : (
                <div key={i} className="flex gap-2">
                  <Avatar />
                  <div className="min-w-0 space-y-2">
                    <p className={`whitespace-pre-wrap rounded-lg rounded-tl-none px-3 py-2 ${m.error ? "bg-amber-50 text-amber-900" : "bg-zinc-100"}`}>
                      {m.text}
                    </p>
                    {m.links.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-zinc-500">Help {m.links.length === 1 ? "guide" : "guides"}:</p>
                        {m.links.map((l) => (
                          <a
                            key={l.url}
                            href={l.url}
                            target="_blank"
                            rel="noopener"
                            className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:border-zinc-900"
                          >
                            {l.title}
                            <span aria-hidden="true">↗</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {pending && (
              <div className="flex items-center gap-2">
                <Avatar />
                <p className="text-zinc-500">Penny is thinking…</p>
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-zinc-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              rows={1}
              maxLength={1500}
              placeholder="Ask a question…"
              aria-label="Your question for Penny"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={pending || !draft.trim()} className="btn h-10 shrink-0 disabled:opacity-50">
              Send
            </button>
          </form>
          <p className="px-3 pb-2 text-[11px] text-zinc-400">Penny is AI and can make mistakes. Check the help guides for the full steps.</p>
        </section>
      )}
    </>
  );
}

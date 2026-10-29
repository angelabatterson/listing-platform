"use client";

import { useEffect, useState } from "react";

type State = "checking" | "missing" | "ready" | "connecting" | "connected" | "failed";

// Talks to the Relistic extension's script on this page through window messages:
// "relistic:hello" finds out whether it's installed, "relistic:connect" hands it a key.
export function ConnectExtension(props: { newKey: () => Promise<string> }) {
  const [state, setState] = useState<State>("checking");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; email?: string; ok?: boolean };
      if (data?.type === "relistic:here") setState((s) => (s === "checking" || s === "missing" ? "ready" : s));
      if (data?.type === "relistic:connected") {
        setEmail(data.email ?? null);
        setState(data.ok ? "connected" : "failed");
      }
    };
    window.addEventListener("message", onMessage);
    const ask = () => window.postMessage({ type: "relistic:hello" }, window.location.origin);
    ask();
    const retry = setInterval(ask, 1000);
    const giveUp = setTimeout(() => setState((s) => (s === "checking" ? "missing" : s)), 2500);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(retry);
      clearTimeout(giveUp);
    };
  }, []);

  async function connect() {
    setState("connecting");
    try {
      const key = await props.newKey();
      window.postMessage({ type: "relistic:connect", key }, window.location.origin);
    } catch {
      setState("failed");
    }
  }

  if (state === "checking") return <p className="text-sm text-zinc-600">Looking for the extension…</p>;
  if (state === "missing")
    return (
      <p className="text-sm text-amber-800">
        The Relistic extension isn&apos;t installed in this Chrome yet. Add it using the steps below, then reload this page.
      </p>
    );
  if (state === "connected")
    return (
      <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
        Connected{email ? ` as ${email}` : ""}. Click the Relistic icon in Chrome&apos;s toolbar to see listings waiting to post.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn" onClick={connect} disabled={state === "connecting"}>
        {state === "connecting" ? "Connecting…" : "Connect the extension"}
      </button>
      {state === "failed" && <span className="text-sm text-red-600">That didn&apos;t work. Reload the page and try again.</span>}
    </div>
  );
}

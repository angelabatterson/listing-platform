// Runs on Relistic's own pages. The Stores page asks whether the extension is here
// ("relistic:hello") and hands it a key to connect with ("relistic:connect").
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data || {};
  const reply = (message) => window.postMessage(message, location.origin);
  if (data.type === "relistic:hello") reply({ type: "relistic:here" });
  if (data.type === "relistic:connect" && typeof data.key === "string") {
    chrome.runtime.sendMessage({ type: "pair", key: data.key, appUrl: location.origin }, (res) => {
      reply({ type: "relistic:connected", ok: Boolean(res?.ok), email: res?.email, error: res?.error });
    });
  }
});

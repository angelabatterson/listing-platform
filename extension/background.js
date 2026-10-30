// The Relistic extension's background worker. It asks Relistic for listings waiting to be
// posted, updated or taken down, opens the store's page for each one the seller starts,
// fills it in (fill.js), and reports back once the store shows the finished listing.
importScripts("sites.js");

const APP_ORIGINS = [RELISTIC_DEFAULT_APP, "http://localhost:3123"];
const CHECK_MINUTES = 1;

async function settings() {
  const s = await chrome.storage.local.get(["appUrl", "key", "email"]);
  return { appUrl: s.appUrl || RELISTIC_DEFAULT_APP, key: s.key, email: s.email };
}

class NotConnected extends Error {
  constructor() {
    super("Connect the extension on Relistic's Stores page.");
  }
}

async function api(path, init = {}) {
  const { appUrl, key } = await settings();
  if (!key) throw new NotConnected();
  const res = await fetch(appUrl + path, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  });
  if (res.status === 401) {
    await chrome.storage.local.remove(["key", "email"]);
    throw new NotConnected();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Relistic answered ${res.status}.`);
  return body;
}

function setBadge(text, color = "#18181b") {
  chrome.action.setBadgeText({ text: text ? String(text) : "" });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Which stores you're signed in to in this Chrome: only whether a sign-in cookie exists.
// Sign-in cookies are set on the bare domain (".facebook.com"), so Chrome only shows them
// to an extension allowed on every subdomain (the "https://*.facebook.com/*" permissions).
async function signInStatus() {
  const status = {};
  for (const [marketplace, site] of Object.entries(RELISTIC_SITES)) {
    const found = await chrome.cookies.getAll({ domain: site.domain });
    status[marketplace] = found.some((c) => site.signInCookies.includes(c.name));
  }
  return status;
}

// Tells Relistic, so the Stores page can show it too, and picks up which stores are added.
async function checkSignIns() {
  const signedIn = await signInStatus();
  // Saved first, so the popup shows it even if Relistic can't be reached.
  await chrome.storage.local.set({ signedIn });
  const me = await api("/api/extension/me", { method: "POST", body: JSON.stringify({ signedIn }) });
  await chrome.storage.local.set({ stores: me.stores });
}

async function refresh() {
  try {
    await checkSignIns();
    const { tasks } = await api("/api/extension/tasks");
    await chrome.storage.local.set({ tasks, checkedAt: Date.now(), error: null });
    setBadge(tasks.length || "");
    return { tasks };
  } catch (err) {
    await chrome.storage.local.set({ error: err.message, ...(err instanceof NotConnected && { tasks: [] }) });
    setBadge("!", "#b45309");
    return { error: err.message };
  }
}

// --- Work in progress, by tab. Kept in session storage because the worker can restart.

async function allWork() {
  return (await chrome.storage.session.get("work")).work || {};
}
async function getWork(tabId) {
  return (await allWork())[tabId];
}
async function setWork(tabId, work) {
  const all = await allWork();
  if (work) all[tabId] = work;
  else delete all[tabId];
  await chrome.storage.session.set({ work: all });
}

async function report(taskId, result) {
  await api(`/api/extension/tasks/${taskId}`, { method: "POST", body: JSON.stringify(result) });
  const all = await allWork();
  for (const [tabId, w] of Object.entries(all)) if (w.task.id === taskId) delete all[tabId];
  await chrome.storage.session.set({ work: all });
  await refresh();
}

// --- Filling in a store's page.

async function toDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

// Photos are downloaded here, where the extension may read Relistic's photo links,
// and handed to the page as data. A photo hosted elsewhere is left for the seller.
async function downloadPhotos(task) {
  const site = RELISTIC_SITES[task.marketplace];
  const photos = [];
  const skipped = [];
  for (const [i, url] of task.listing.photos.slice(0, site.maxPhotos).entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      photos.push({ name: `photo-${i + 1}.jpg`, dataUrl: await toDataUrl(await res.blob()) });
    } catch {
      skipped.push(i + 1);
    }
  }
  return { photos, skipped, tooMany: Math.max(0, task.listing.photos.length - site.maxPhotos) };
}

async function inject(tabId, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["fill.js"] });
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result?.result;
}

async function fillPage(tabId, work) {
  work.filling = true;
  await setWork(tabId, work);
  const { photos, skipped, tooMany } =
    work.task.kind === "list" ? await downloadPhotos(work.task) : { photos: [], skipped: [], tooMany: 0 };
  const result = await inject(
    tabId,
    (task, photos, notes) => window.relisticFill(task, photos, notes),
    [work.task, photos, { skipped, tooMany }],
  ).catch((err) => ({ error: err.message }));
  await setWork(tabId, { ...work, filling: false, filled: true, result });
}

async function showBanner(tabId, work, mode) {
  await inject(tabId, (task, mode) => window.relisticBanner(task, mode), [work.task, mode]).catch(() => {});
}

async function start(taskId) {
  let { tasks } = await chrome.storage.local.get("tasks");
  let task = (tasks || []).find((t) => t.id === taskId);
  if (!task) {
    ({ tasks } = await refresh());
    task = (tasks || []).find((t) => t.id === taskId);
  }
  if (!task) throw new Error("That listing isn't waiting any more.");
  const site = RELISTIC_SITES[task.marketplace];
  const url =
    task.kind === "list" ? site.createUrl : task.kind === "update" ? site.editUrl(task) : task.remoteUrl || site.editUrl(task);
  if (!url) throw new Error(`Relistic doesn't have this item's ${site.name} link. Find it on ${site.name} yourself.`);
  // Note the tab before it loads, so its first page load isn't missed.
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  await setWork(tab.id, { task, filled: false });
  await chrome.tabs.update(tab.id, { url });
}

// Follow each tab Relistic opened: fill the form when it loads, and notice the
// finished listing when the store shows it.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url && info.status !== "complete") return;
  const work = await getWork(tabId);
  if (!work || !tab.url) return;
  const site = RELISTIC_SITES[work.task.marketplace];
  const url = new URL(tab.url);

  if (work.task.kind === "end") {
    if (info.status === "complete") await showBanner(tabId, work, "end");
    return;
  }
  if (work.filled) {
    const found = site.listingFromUrl(url);
    if (found) return report(work.task.id, { result: "done", ...found });
    if (site.postedWithoutLink?.(url)) return report(work.task.id, { result: "done" });
    // Somewhere else: ask whether it was posted rather than guess.
    if (info.status === "complete" && !site.isFormPage(url)) await showBanner(tabId, work, "ask");
    return;
  }
  if (info.status === "complete" && site.isFormPage(url) && !work.filling) await fillPage(tabId, work);
});

chrome.tabs.onRemoved.addListener((tabId) => setWork(tabId, null));

// --- Messages from the popup, the Relistic page and the banners on store pages.

function allowedApp(origin) {
  return APP_ORIGINS.includes(origin);
}

async function pair(key, appUrl) {
  if (!allowedApp(appUrl)) throw new Error("That isn't the Relistic site.");
  await chrome.storage.local.set({ key, appUrl });
  const me = await api("/api/extension/me");
  await chrome.storage.local.set({ email: me.email, stores: me.stores });
  await refresh();
  return me.email;
}

async function handle(message, sender) {
  switch (message.type) {
    case "pair":
      if (!sender.origin || sender.origin !== message.appUrl) throw new Error("That isn't the Relistic site.");
      return { email: await pair(message.key, message.appUrl) };
    case "refresh":
      return refresh();
    case "start":
      await start(message.taskId);
      return {};
    case "skip":
      await report(message.taskId, { result: "skipped" });
      return {};
    case "posted": {
      // Pressed on the banner: use the page the seller is on, if it's the listing.
      const tab = sender.tab;
      const work = tab && (await getWork(tab.id));
      const task = work?.task;
      if (!task || task.id !== message.taskId) throw new Error("This tab isn't working on that listing.");
      const found = RELISTIC_SITES[task.marketplace].listingFromUrl(new URL(tab.url));
      await report(task.id, { result: "done", ...(found || {}) });
      return {};
    }
    case "notPosted": {
      const tab = sender.tab;
      const work = tab && (await getWork(tab.id));
      if (work) await setWork(tab.id, { ...work, filled: false });
      return {};
    }
    case "disconnect":
      await chrome.storage.local.remove(["key", "email", "tasks", "stores", "signedIn"]);
      setBadge("");
      return {};
    default:
      throw new Error("Unknown request");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: err.message }),
  );
  return true;
});

chrome.alarms.create("check", { periodInMinutes: CHECK_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "check" && refresh());
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener(refresh);

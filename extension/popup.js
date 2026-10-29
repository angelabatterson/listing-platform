// The toolbar popup: who's connected, and the listings waiting to be posted, updated or taken down.
const main = document.getElementById("main");
const footer = document.getElementById("footer");

const KIND = { list: "Post", update: "Update", end: "Take down" };
const KIND_NOTE = { list: "Waiting to post", update: "Changed in Relistic", end: "Sold elsewhere" };

const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function render() {
  const { key, email, appUrl, tasks = [], error, checkedAt } = await chrome.storage.local.get([
    "key", "email", "appUrl", "tasks", "error", "checkedAt",
  ]);
  const app = appUrl || RELISTIC_DEFAULT_APP;
  main.replaceChildren();
  footer.replaceChildren();

  if (!key) {
    main.append(
      el("p", { textContent: "Connect this extension to your Relistic account to post to Poshmark, Depop and Facebook Marketplace." }),
      el("button", { textContent: "Open Relistic to connect", onclick: () => chrome.tabs.create({ url: `${app}/stores` }) }),
    );
    return;
  }

  if (error) main.append(el("p", { className: "error", textContent: error }));
  if (tasks.length === 0) {
    main.append(el("p", { textContent: "Nothing waiting. Tick Poshmark, Depop or Facebook on an item in Relistic to list it there." }));
  } else {
    const list = el("ul");
    for (const t of tasks) {
      const status = el("div", { className: "meta", textContent: `${t.store} · ${KIND_NOTE[t.kind]}` });
      const go = el("button", { textContent: KIND[t.kind] });
      const skip = el("button", { className: "secondary", textContent: "Skip" });
      go.onclick = async () => {
        go.disabled = true;
        const res = await send({ type: "start", taskId: t.id });
        if (res?.ok) window.close();
        else {
          go.disabled = false;
          status.textContent = res?.error || "That didn't work.";
          status.className = "meta error";
        }
      };
      skip.onclick = async () => {
        skip.disabled = true;
        await send({ type: "skip", taskId: t.id });
        render();
      };
      list.append(el("li", {}, el("div", { className: "title", textContent: t.listing.title }), status, el("div", { className: "row" }, go, skip)));
    }
    main.append(list);
  }

  const when = checkedAt ? new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "never";
  footer.append(
    `${email || "Connected"} · checked ${when} · `,
    el("button", {
      className: "link",
      textContent: "Disconnect",
      onclick: async () => {
        await send({ type: "disconnect" });
        render();
      },
    }),
  );
}

document.getElementById("refresh").onclick = async () => {
  await send({ type: "refresh" });
  render();
};

render();
send({ type: "refresh" }).then(render);

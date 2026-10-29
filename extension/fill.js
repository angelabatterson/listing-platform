// Injected into a store's listing page. Fills in what Relistic knows (photos, title,
// description, price, brand) and shows a banner so the seller can finish and press Post.
// Fields are found by their visible labels rather than the stores' internal names,
// which change often.
(() => {
  if (window.relisticFill) return;

  const SITES = {
    poshmark: {
      name: "Poshmark",
      fields: {
        title: ["listing title", "title", "what are you selling"],
        description: ["description", "describe it"],
        price: ["listing price"],
        brand: ["brand"],
      },
      left: "category, size, condition and original price",
      post: "Next, then List",
    },
    depop: {
      name: "Depop",
      // Depop has no title, so the description starts with it.
      fields: { description: ["description"], price: ["price"] },
      left: "category, brand, size, condition and shipping",
      post: "Post",
    },
    facebook: {
      name: "Facebook Marketplace",
      fields: { title: ["title"], price: ["price"], description: ["description"] },
      // Pop-up menus, picked by the option's words. Each Relistic condition lists the
      // site's options to try, best first.
      menus: {
        condition: {
          labels: ["condition"],
          options: {
            NEW: ["New"],
            NEW_OTHER: ["Used - Like New", "New"],
            NEW_WITH_DEFECTS: ["Used - Good"],
            USED_EXCELLENT: ["Used - Like New"],
            USED_VERY_GOOD: ["Used - Good"],
            USED_GOOD: ["Used - Good"],
            USED_ACCEPTABLE: ["Used - Fair"],
            FOR_PARTS_OR_NOT_WORKING: ["Used - Fair"],
          },
        },
      },
      left: "category",
      post: "Next, then Publish",
    },
    mercari: {
      name: "Mercari",
      fields: {
        title: ["title", "what are you selling"],
        description: ["description", "describe your item"],
        price: ["listing price", "price"],
        brand: ["brand"],
      },
      left: "category, condition and shipping",
      post: "List",
    },
    whatnot: {
      name: "Whatnot",
      fields: { title: ["title"], description: ["description"], price: ["price", "buy it now price"] },
      left: "category, format (Buy It Now or auction), quantity and shipping",
      post: "Publish",
    },
  };

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  // Everything a person would read as this field's name.
  function namesOf(el) {
    const names = [el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.name, el.id];
    for (const id of (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)) {
      names.push(document.getElementById(id)?.textContent);
    }
    if (el.id) names.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent);
    names.push(el.closest("label")?.textContent);
    // The nearest small block of text around it, like a heading above the box.
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const text = norm(node.textContent);
      if (text && text.length <= 60) {
        names.push(text);
        break;
      }
    }
    return names.map(norm).filter(Boolean);
  }

  function findField(labels) {
    const boxes = [...document.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']")].filter(
      (el) => visible(el) && !["file", "checkbox", "radio", "hidden", "submit", "button"].includes(el.type),
    );
    // Earlier labels are the better matches, so try them first, exact names before partial ones.
    for (const label of labels) {
      const exact = boxes.find((el) => namesOf(el).some((n) => n === label || n === `${label} *` || n.startsWith(`${label} (`)));
      if (exact) return exact;
    }
    for (const label of labels) {
      const partial = boxes.find((el) => namesOf(el).some((n) => n.includes(label)));
      if (partial) return partial;
    }
    return null;
  }

  // Set a value the way typing would, so the page's own scripts notice it.
  function setValue(el, value) {
    el.focus();
    if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    el.blur();
  }

  function dataUrlToFile({ name, dataUrl }) {
    const [head, base64] = dataUrl.split(",");
    const type = head.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new File([bytes], name, { type });
  }

  function addPhotos(photos) {
    if (photos.length === 0) return true;
    const input = [...document.querySelectorAll("input[type='file']")].find((el) => !el.accept || /image|jpe?g|png/.test(el.accept));
    if (!input) return false;
    const transfer = new DataTransfer();
    for (const p of input.multiple ? photos : photos.slice(0, 1)) transfer.items.add(dataUrlToFile(p));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Option words compared loosely: case, spacing and the kind of dash don't matter.
  const loose = (s) => norm(s).replace(/[\u2010-\u2015]/g, "-").replace(/\s*-\s*/g, " - ");

  // Pick an option in a drop-down, whether a real <select> or a pop-up menu.
  async function choose(labels, wanted) {
    const want = wanted.map(loose);
    const boxes = [
      ...document.querySelectorAll("select, [role='combobox'], [aria-haspopup='listbox'], [aria-haspopup='menu']"),
    ].filter(visible);
    const box = boxes.find((el) =>
      [...namesOf(el), norm(el.textContent)].some((n) => labels.some((l) => n === l || n.startsWith(l))),
    );
    if (!box) return false;
    if (box instanceof HTMLSelectElement) {
      const option = [...box.options].find((o) => want.includes(loose(o.textContent)));
      if (!option) return false;
      box.value = option.value;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    box.click();
    for (let i = 0; i < 10; i++) {
      await wait(300);
      const options = [...document.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio']")].filter(visible);
      for (const w of want) {
        const option = options.find((o) => loose(o.textContent) === w);
        if (option) {
          option.click();
          return true;
        }
      }
    }
    // Close the menu again so the seller can pick by hand.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }

  // Stores build their forms with scripts after the page loads, so wait for a field.
  async function waitForForm(site) {
    const first = Object.values(site.fields)[0];
    for (let i = 0; i < 40; i++) {
      if (findField(first)) return true;
      await wait(500);
    }
    return false;
  }

  const money = (cents) => (cents / 100).toFixed(2).replace(/\.00$/, "");

  window.relisticFill = async (task, photos, notes) => {
    const site = SITES[task.marketplace];
    const l = task.listing;
    const filled = [];
    const missed = [];
    if (!(await waitForForm(site))) {
      window.relisticBanner(task, "nofind");
      return { filled, missed: ["the form"] };
    }

    if (task.kind === "list") {
      if (addPhotos(photos)) {
        if (photos.length) filled.push(photos.length === 1 ? "1 photo" : `${photos.length} photos`);
      } else missed.push("photos");
      // Photo uploads redraw some forms, so give them a moment.
      await wait(1500);
    }

    const description = task.marketplace === "depop" ? `${l.title}\n\n${l.description}` : l.description;
    const values = { title: l.title, description, price: money(l.priceCents), brand: l.brand || "" };
    const names = { title: "title", description: "description", price: "price", brand: "brand" };
    for (const [key, labels] of Object.entries(site.fields)) {
      if (!values[key]) continue;
      const el = findField(labels);
      if (el) {
        setValue(el, values[key]);
        filled.push(names[key]);
      } else missed.push(names[key]);
    }

    for (const [key, menu] of Object.entries(site.menus || {})) {
      const wanted = menu.options[l[key]];
      if (!wanted) continue;
      if (await choose(menu.labels, wanted)) filled.push(key);
      else missed.push(key);
    }

    const extra = [];
    if (notes.skipped.length) extra.push(`Photo ${notes.skipped.join(", ")} couldn't be copied, so add it yourself.`);
    if (notes.tooMany) extra.push(`${site.name} takes ${l.photos.length - notes.tooMany} photos, so the last ${notes.tooMany} were left out.`);
    window.relisticBanner(task, "filled", { filled, missed, extra });
    return { filled, missed };
  };

  const list = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

  // A bar across the top of the store's page. It lives in its own shadow root so the
  // store's styles don't change it.
  window.relisticBanner = (task, mode, info = {}) => {
    document.getElementById("relistic-banner")?.remove();
    const site = SITES[task.marketplace];
    const host = document.createElement("div");
    host.id = "relistic-banner";
    host.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    const bar = document.createElement("div");
    bar.style.cssText =
      "font:14px/1.4 system-ui,sans-serif;background:#18181b;color:#fff;padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.3)";
    const text = document.createElement("div");
    text.style.cssText = "flex:1 1 320px";
    const title = `"${task.listing.title}"`;
    const lines = [];
    let primary = null;
    if (mode === "filled") {
      lines.push(
        info.filled.length ? `Relistic filled in the ${list(info.filled)} for ${title}.` : `Relistic couldn't fill in this form for ${title}.`,
      );
      if (info.missed.length) lines.push(`Please add the ${list(info.missed)} yourself.`);
      lines.push(...info.extra);
      lines.push(`Choose the ${site.left}, check everything, then press ${site.post}.`);
      primary = ["I've posted it", "posted"];
    } else if (mode === "ask") {
      lines.push(`Did you post ${title} on ${site.name}? If you're on its listing page now, Relistic will save the link.`);
      primary = ["Yes, it's posted", "posted"];
    } else if (mode === "nofind") {
      lines.push(`Relistic couldn't find the listing form. Fill in ${title} yourself, then press ${site.post}.`);
      primary = ["I've posted it", "posted"];
    } else if (mode === "end") {
      lines.push(`${title} sold somewhere else. Delete it or mark it sold on ${site.name}, then tell Relistic.`);
      primary = ["I've taken it down", "posted"];
    }
    text.textContent = lines.join(" ");
    bar.append(text);

    const button = (label, type, filledStyle) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `font:inherit;border-radius:6px;padding:6px 12px;cursor:pointer;border:1px solid #fff;${
        filledStyle ? "background:#fff;color:#18181b;" : "background:transparent;color:#fff;"
      }`;
      b.onclick = () => {
        b.disabled = true;
        chrome.runtime.sendMessage({ type, taskId: task.id }, (res) => {
          if (res?.ok) host.remove();
          else {
            b.disabled = false;
            text.textContent = res?.error || "That didn't work. Try again.";
          }
        });
      };
      return b;
    };
    if (primary) bar.append(button(primary[0], primary[1], true));
    if (mode === "ask") bar.append(button("Not yet", "notPosted", false));
    bar.append(button("Skip this item", "skip", false));
    root.append(bar);
    document.documentElement.append(host);
  };
})();

// Builds the static marketing site (getrelistic.com) and help docs (doc.getrelistic.com)
// into website/dist/site and website/dist/docs. No dependencies: each page in site/ and
// docs/ is an HTML fragment with a front-matter comment, wrapped in the layouts below.
//   node website/build.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

const SITE = "https://getrelistic.com";
const DOCS = "https://doc.getrelistic.com";
const APP = "https://app.getrelistic.com";
const YEAR = 2026;
const CONTACT = "angela.b@apeirosmarketing.com";

// Help articles, in sidebar order.
const DOC_GROUPS = [
  ["Start here", ["getting-started", "connect-stores", "chrome-extension"]],
  ["Listing", ["add-items", "photo-batches", "import-listings"]],
  ["Selling", ["sales-sync", "shipping-labels", "automations", "dashboard-crm"]],
  ["Your account", ["billing-account", "faq"]],
];

function read(path) {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^<!--\n([\s\S]*?)\n-->\n/);
  if (!m) throw new Error(`${path}: missing front matter`);
  const meta = Object.fromEntries(
    m[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return { ...meta, body: raw.slice(m[0].length) };
}

function write(path, html) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function head({ title, description, url }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/img/logo-512.png">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>`;
}

const menuScript = `<script>
document.querySelectorAll("[data-toggle]").forEach(function (b) {
  b.addEventListener("click", function () {
    var t = document.getElementById(b.getAttribute("data-toggle"));
    t.classList.toggle("open");
    b.setAttribute("aria-expanded", t.classList.contains("open"));
  });
});
</script>`;

function header({ brandHref, tag, links, current }) {
  const nav = links
    .map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("\n      ");
  return `<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${brandHref}"><img src="/assets/img/favicon.svg" alt="" width="30" height="30">Relistic${tag ? ` <span class="tag">${tag}</span>` : ""}</a>
    <button class="menu-toggle" data-toggle="nav" aria-expanded="false" aria-label="Menu">Menu</button>
    <nav class="nav" id="nav">
      ${nav}
      <a class="btn" href="${APP}/signup">Start free trial</a>
    </nav>
  </div>
</header>`;
}

function footer(siteBase) {
  return `<footer class="site-footer">
  <div class="wrap">
    <div>© ${YEAR} Apeiros Marketing, LLC. Relistic is a product of Jangle Enterprises, LLC.</div>
    <nav>
      <a href="${siteBase}/">Home</a>
      <a href="${siteBase}/pricing/">Pricing</a>
      <a href="${siteBase}/about/">About</a>
      <a href="${DOCS}/">Help</a>
      <a href="${APP}/privacy">Privacy</a>
      <a href="${APP}/login">Log in</a>
    </nav>
  </div>
</footer>
${menuScript}
</body>
</html>
`;
}

// Fragments may use {{APP}}, {{SITE}} and {{DOCS}} for the three addresses.
const fill = (s) => s.replaceAll("{{APP}}", APP).replaceAll("{{SITE}}", SITE).replaceAll("{{DOCS}}", DOCS);

function buildSite() {
  const out = join(dist, "site");
  const pages = [
    ["index", "/"],
    ["pricing", "/pricing/"],
    ["about", "/about/"],
  ];
  const links = [
    ["/#features", "Features"],
    ["/pricing/", "Pricing"],
    ["/about/", "About"],
    [`${DOCS}/`, "Help"],
    [`${APP}/login`, "Log in"],
  ];
  for (const [name, path] of pages) {
    const p = read(join(root, "site", `${name}.html`));
    const html =
      head({ title: p.title, description: p.description, url: SITE + path }) +
      header({ brandHref: "/", links, current: path }) +
      `\n<main>\n${fill(p.body)}</main>\n` +
      footer("");
    write(join(out, path, "index.html"), html);
  }
  cpSync(join(root, "assets"), join(out, "assets"), { recursive: true });
  write(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  write(join(out, "sitemap.xml"), sitemap(pages.map(([, path]) => SITE + path)));
}

function buildDocs() {
  const out = join(dist, "docs");
  const articles = DOC_GROUPS.flatMap(([group, slugs]) =>
    slugs.map((slug) => ({ slug, group, ...read(join(root, "docs", `${slug}.html`)) })),
  );
  const links = [
    [`${SITE}/`, "Relistic home"],
    [`${SITE}/pricing/`, "Pricing"],
    [`${APP}/login`, "Log in"],
  ];

  const sidebar = (current) => `<aside id="toc">
    <button class="toc-toggle" data-toggle="toc" aria-expanded="false">All help topics <span>▾</span></button>
    <div class="toc">
      <h4>Help center</h4>
      <a href="/"${current === "" ? ' aria-current="page"' : ""}>Home</a>
${DOC_GROUPS.map(
  ([group, slugs]) =>
    `      <h4>${group}</h4>\n` +
    slugs
      .map((s) => {
        const a = articles.find((x) => x.slug === s);
        return `      <a href="/${s}/"${s === current ? ' aria-current="page"' : ""}>${a.title}</a>`;
      })
      .join("\n"),
).join("\n")}
    </div>
  </aside>`;

  const page = (slug, title, description, body) =>
    head({ title: slug ? `${title} · Relistic Help` : title, description, url: `${DOCS}/${slug ? `${slug}/` : ""}` }) +
    header({ brandHref: "/", tag: "Help", links, current: "" }) +
    `\n<main class="wrap docs">\n  ${sidebar(slug)}\n  <article class="article">\n${body}  </article>\n</main>\n` +
    footer(SITE);

  articles.forEach((a, i) => {
    const prev = articles[i - 1];
    const next = articles[i + 1];
    const pager = `<nav class="pager">
  <span>${prev ? `<a href="/${prev.slug}/">← Previous<strong>${prev.title}</strong></a>` : ""}</span>
  <span style="text-align:right">${next ? `<a href="/${next.slug}/">Next →<strong>${next.title}</strong></a>` : ""}</span>
</nav>
<p class="small muted" style="margin-top:24px">Still stuck? Email <a href="mailto:${CONTACT}">${CONTACT}</a> and we'll help.</p>
`;
    const body = `<h1>${a.title}</h1>\n<p class="summary">${a.description}</p>\n${fill(a.body)}${pager}`;
    write(join(out, a.slug, "index.html"), page(a.slug, a.title, a.description, body));
  });

  const home = `<h1>Relistic Help Center</h1>
<p class="summary">Step-by-step guides for listing once and selling everywhere. New here? Start with <a href="/getting-started/">Getting started</a>.</p>
${DOC_GROUPS.map(
  ([group, slugs]) =>
    `<h2>${group}</h2>\n<div class="topic-grid">\n` +
    slugs
      .map((s) => {
        const a = articles.find((x) => x.slug === s);
        return `  <a class="card" href="/${s}/"><h3>${a.title}</h3><p>${a.description}</p></a>`;
      })
      .join("\n") +
    "\n</div>",
).join("\n")}
<div class="callout" style="margin-top:40px"><p>Can't find what you need? Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p></div>
`;
  write(
    join(out, "index.html"),
    page("", "Relistic Help Center", "How to use Relistic: connect your stores, list items, sync sales and ship orders.", home),
  );
  cpSync(join(root, "assets"), join(out, "assets"), { recursive: true });
  write(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${DOCS}/sitemap.xml\n`);
  write(join(out, "sitemap.xml"), sitemap([`${DOCS}/`, ...articles.map((a) => `${DOCS}/${a.slug}/`)]));
}


function sitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
}

rmSync(dist, { recursive: true, force: true });
buildSite();
buildDocs();
console.log("Built website/dist/site and website/dist/docs");

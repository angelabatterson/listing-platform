# Relistic website and help docs

Static pages, no framework:

- `site/` is the marketing site for **getrelistic.com** (Home, Pricing, About).
- `docs/` is the help center for **doc.getrelistic.com**. Sidebar order is `DOC_GROUPS` in `docs.mjs`.
- `assets/` (styles, logo, screenshots) is copied into both.

After changing a guide, run `node scripts/build-help-index.mjs` so Penny, the in-app help assistant, knows the new text (it writes `src/lib/help/articles.json`; a test fails if you forget).

Each page is an HTML fragment that starts with a front-matter comment (`title`, `description`), wrapped in the layouts in `build.mjs`. `{{APP}}`, `{{SITE}}` and `{{DOCS}}` in a fragment become the three addresses.

`bash scripts/package-website.sh` builds `website/dist/` and zips it into `relistic-website.zip` and `relistic-docs.zip`. Every change to `main` attaches both to the GitHub release alongside `relistic-cpanel.zip`.

## Putting it on cPanel

- **getrelistic.com:** extract `relistic-website.zip` into `public_html`. Leave the `app` folder there alone; it belongs to app.getrelistic.com.
- **doc.getrelistic.com:** create the domain in cPanel **Domains** (not sharing `public_html`'s document root), then extract `relistic-docs.zip` into its folder.

Extracting over the old files updates the site.

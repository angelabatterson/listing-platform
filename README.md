# Relistic

A SaaS for resellers: keep one inventory, choose which marketplaces each item appears on, and keep every store in sync. When an item sells in one place it comes down everywhere else.

Only marketplaces with official public APIs are supported: eBay and Etsy today.

## What's here

- **Accounts:** sign up, log in, one workspace per client business.
- **Stores:** connect eBay and Etsy through each marketplace's own sign-in. Tokens are encrypted at rest (AES-256-GCM).
- **Inventory:** a master record per item (title, SKU, price, quantity, condition, photos), with a per-store "list it here" checkbox and optional per-store price.
- **Sync:** saving an item creates, updates, or ends its listing on every ticked store. Problems are shown in plain language on the item and in the Activity log.
- **Sales:** when an item sells on one store, its quantity drops and the other stores are updated, or the item is ended everywhere if none are left. Sales arrive from Etsy's `order.paid` webhook within seconds, and a check every 5 minutes (`/api/cron/check-sales`) picks up eBay orders and anything a webhook missed. Each order line is counted once, and a sale of more than was in stock is flagged as an oversell.
- **Photo batches (AI listing assistant):** upload a pile of photos at once (resized in the browser first). Claude sorts them into items, then writes each listing: title, description, condition, brand, item specifics, a suggested price, and Etsy's "when made". Each becomes a draft item with an automatic SKU (`B12-3` is item 3 of batch 12) for the seller to check before listing. A batch holds up to 250 photos on Starter (and the trial), 500 on Pro and 1,000 on Business; big batches are sorted 100 photos at a time, with each chunk's last item carried into the next so it isn't split. Photos are stored in Postgres and served to eBay and Etsy through signed links at `/api/photos/...`. When an eBay store is ready, each draft also gets eBay's best-matching category (Taxonomy API) and the AI fills that category's required and recommended item specifics, keeping only values eBay accepts.
- **Review and post:** each batch has a review board listing every draft with its photo, title, price and condition (editable in place), plus anything that would stop it posting, such as a missing category. Tick the drafts that are ready and post them all at once. "Download CSV" exports the batch (SKU, title, price, condition, specifics, categories, photo links) with cells made safe for spreadsheets.
- **Listing helpers on the item page:** find an eBay or Etsy category from the title, check which item specifics eBay requires and fill them with AI, and compare prices against similar fixed-price eBay listings (Browse API; these are asking prices, since sold prices need eBay's restricted Marketplace Insights API).
- **Subscriptions (Stripe):** a 14-day free trial, then Starter, Pro or Business plans that cap active listings and AI drafts a month. Checkout, card changes, plan switches and cancelling happen on Stripe's own pages. An account without a working plan can't post, edit or draft, but its sales are still synced so nothing oversells.
- **eBay compliance:** the Marketplace Account Deletion endpoint eBay requires before it issues production keys.

## Stack

Next.js 16 (App Router, TypeScript), Postgres with Drizzle ORM, Tailwind CSS, Vitest.

## Running it locally

1. Install Node 22+ and Postgres.
2. `npm install`
3. Copy `.env.example` to `.env` and fill it in. `ENCRYPTION_KEY` comes from `openssl rand -base64 32`, or use any random password of 32+ characters.
4. `npm run db:migrate`
5. `npm run dev`, then open http://localhost:3000

## Hosting on cPanel

Every change to `main` builds `relistic-cpanel.zip` (GitHub **Releases**, latest). It's the standalone Next.js server with everything it needs, so nothing is installed on the server.

1. Upload the zip with **File Manager** into a folder outside `public_html` (for example `~/relistic`) and extract it there. Anything inside `public_html` can be downloaded.
2. Register the app:
   - **Setup Node.js App** (CloudLinux servers): Node.js 20 or newer, mode Production, your domain, the folder from step 1, and startup file `app.js`.
   - **Application Manager** (other cPanel servers): if it's missing, a WHM admin turns on `mod-passenger`, `mod_env` and `nodejs22` in **EasyApache 4**, and **Application Manager** in **Feature Manager**. Register the app with your domain, base URL `/`, the folder from step 1, and Production. Passenger starts `app.js` by itself. Don't click **Ensure dependencies**: the zip already has everything.
3. Add the environment variables from `.env.example` in the app's settings, then restart or deploy. Database changes are applied automatically when the app starts.
4. Schedule the sales check in **Cron Jobs** every 5 minutes: `curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR_DOMAIN/api/cron/check-sales`.

The database can be cPanel's **PostgreSQL Databases** or any hosted Postgres (Neon's free plan works).

## Setting up eBay (sandbox)

1. Create a developer account at https://developer.ebay.com and create a **Sandbox** keyset.
2. Put the App ID and Cert ID in `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`.
3. Under **User Tokens**, add an eBay Redirect URL (RuName). Set its "auth accepted URL" to `${APP_URL}/api/ebay/oauth/callback` (eBay requires https, so use a tunnel or the deployed URL). Put the RuName in `EBAY_RUNAME`.
4. Create a sandbox seller test user, sign in to it, and create a shipping, payment and return policy.
5. In the app, go to **Stores**, click **Connect eBay**, then pick the policies and your ship-from ZIP code.

## Setting up Etsy

1. Create an app at https://www.etsy.com/developers/your-apps. Put the keystring and shared secret in `ETSY_KEYSTRING` and `ETSY_SHARED_SECRET`.
2. Add `${APP_URL}/api/etsy/oauth/callback` as the app's callback URL.
3. In the app's Webhook portal, add an endpoint for `${APP_URL}/api/etsy/webhook` with the `order.paid` event, and put its signing secret in `ETSY_WEBHOOK_SECRET`.
4. In the shop, set up at least one shipping profile, return policy and processing profile.
5. In the app, go to **Stores**, click **Connect Etsy**, then pick them.

Etsy starts new apps with limited access. Serving many sellers needs Etsy's Commercial Access, which Etsy reviews by hand.

## AI listing assistant

Set `ANTHROPIC_API_KEY` (from console.anthropic.com). It uses Claude Opus 5.5 with structured output, so answers always match the shape the app expects. If the model declines a request, the API retries on Anthropic's recommended fallback model (`fallbacks: "default"`); if every model declines, the item is left for the seller to fill in. Without a key, batches still upload and can be sorted by hand.

## Subscriptions (Stripe)

Billing is off until `STRIPE_SECRET_KEY` is set; until then every account has full use. Accounts whose email is in `BILLING_EXEMPT_EMAILS` (comma-separated) are on the Free unlimited plan: no charge and no limits. Sellers manage their account (name, business name, email, password) and billing from the menu under their name; the Billing page has a **Cancel subscription** link straight to Stripe's cancel confirmation.

| Plan | Active listings | AI drafts a month |
|---|---|---|
| Free trial (14 days) | 100 | 50 |
| Starter | 100 | 50 |
| Pro | 500 | 300 |
| Business | Unlimited | 1,000 |

Limits are in `src/lib/billing/plans.ts`. Prices are set in Stripe, so they can change without a code change. Use Stripe's test mode first.

1. In Stripe's **Product catalog**, create three products (Starter, Pro, Business), each with one monthly recurring price. Put the price IDs (`price_...`) in `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` and `STRIPE_PRICE_BUSINESS`.
2. Put the secret key (**Developers > API keys**) in `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint for `${APP_URL}/api/stripe/webhook` with the events `checkout.session.completed` and `customer.subscription.created`, `.updated`, `.deleted`, `.paused` and `.resumed`. Put its signing secret (`whsec_...`) in `STRIPE_WEBHOOK_SECRET`.
4. In **Settings > Billing > Customer portal**, let customers update payment methods, cancel, and switch between the three products.

Choosing a plan during the free trial keeps the remaining trial days: the card is charged when the trial ends. When a payment fails the account keeps working while Stripe retries (`past_due`); once the subscription is cancelled or unpaid, the account can't post, edit or use the AI, but sales are still synced and its data is kept.

## Shipping labels (Shippo)

Each seller buys labels through their own Shippo account, so postage is billed to them by Shippo, not to Relistic. On the **Shipping** page a seller pastes their Shippo API token (stored encrypted), their ship-from address and their usual box. Orders from the last 30 days without a Relistic label are listed there; buying a label sends the tracking number to eBay (`createShippingFulfillment`) or Etsy (receipt tracking, which needs the `transactions_w` scope, so Etsy stores connected before it was added must reconnect). A `shippo_test_` token buys free sample labels and never sends tracking to a store.

Buyer addresses are read from the store when a label is bought and aren't saved.

## Shopify

Sellers connect their store on the Stores page by typing its `*.myshopify.com` address; Relistic then goes through Shopify's OAuth install (`src/app/api/shopify/oauth`). Set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` from the app in the Shopify Partner Dashboard, with `${APP_URL}/api/shopify/oauth/callback` as its allowed redirection URL.

Each item becomes one product with a single variant (`productSet` in the Admin GraphQL API), stocked at the store's first active location. Photos are sent only when the product is created. Ending a listing sets the product to Draft. Sales come from the scheduled check, which reads paid orders; Shopify doesn't report its payment fees there, and buyer details need Shopify's protected customer data approval, so neither is saved. `/api/shopify/webhooks` handles `app/uninstalled` and the privacy webhooks every public app must answer.

## TikTok Shop

Sellers press **Connect TikTok Shop** on the Stores page and authorize Relistic in TikTok's US seller authorization page (`src/app/api/tiktok/oauth`). Set `TIKTOK_APP_ID` (used as the service id), `TIKTOK_APP_KEY` and `TIKTOK_APP_SECRET` from the Partner Center app, whose redirect URL must be `${APP_URL}/api/tiktok/oauth/callback`. Every API call is signed (`signRequest` in `src/lib/marketplaces/tiktok/client.ts`).

Each item becomes one product with one SKU, stocked at the shop's default warehouse, using the item's TikTok category ID or the category TikTok recommends for its title, and the seller's usual package weight from the Stores page. Photos are uploaded to TikTok when the product is created. Later saves change only the title, description, price and stock (partial edit), so the product doesn't go back through TikTok's review. Ending a listing deactivates the product. Sales come from the scheduled check's order search; fees and buyer details aren't saved.

## Poshmark, Depop, Mercari, Grailed, Facebook Marketplace and Whatnot (Chrome extension)

None of these has a public listing API for US sellers, so they're worked through the
Relistic Chrome extension in `extension/`, in the seller's own signed-in browser.
Ticking one of these stores on an item queues an `extension_tasks` row instead of
calling an API (`src/lib/extension/tasks.ts`). The extension checks
`/api/extension/tasks` every minute with its own key. When the seller presses Post in
the extension's popup, it opens the store's listing form and fills in the photos,
title, description and price (`extension/fill.js`). The seller finishes the form and
presses the store's Post button. The extension then reports the new listing's link
to `/api/extension/tasks/:id`.

Sellers connect the extension from the Stores page. To try it locally, open
`chrome://extensions`, turn on Developer mode, choose Load unpacked, and pick the
`extension/` folder. The cPanel package serves a zip of the extension at
`/relistic-extension.zip`.

## Importing existing listings

On the Stores page, a connected eBay or Etsy store has an **Import my listings** button. It reads the store's live listings a page at a time (`src/lib/import.ts`) and adds each one to Inventory, already linked to its listing. A listing whose SKU or title matches an item already in Relistic is linked to that item instead of copied, and running the import again skips listings imported before. Listings with variations are skipped for now, and new active items stop at the plan's listing limit.

eBay listings made on eBay's own website aren't visible to the Inventory API, so they're read and managed through eBay's XML Trading API (`src/lib/marketplaces/ebay/trading.ts`). For those listings Relistic syncs only price and quantity, ends them when the item sells elsewhere, and relists them if it comes back. Their title, photos and description stay as they are on eBay.

## Scheduled sales check

`vercel.json` runs `/api/cron/check-sales` every 5 minutes on Vercel (this needs a paid Vercel plan; the free plan runs crons once a day). Set `CRON_SECRET`; Vercel sends it automatically. Anywhere else, call the endpoint on a schedule with `Authorization: Bearer $CRON_SECRET`.

## Checks

```
npm run typecheck
npm run lint
npm test
```

The database tests run when `TEST_DATABASE_URL` points at an empty, migrated Postgres database (CI does this). They delete all data in it.

## Roadmap

- Step 4: real-account testing, verifying signatures on eBay deletion notices, Etsy Commercial Access.

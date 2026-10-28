# Listing Sync

A SaaS for resellers: keep one inventory, choose which marketplaces each item appears on, and keep every store in sync. When an item sells in one place it comes down everywhere else.

Only marketplaces with official public APIs are supported: eBay and Etsy today.

## What's here

- **Accounts:** sign up, log in, one workspace per client business.
- **Stores:** connect eBay and Etsy through each marketplace's own sign-in. Tokens are encrypted at rest (AES-256-GCM).
- **Inventory:** a master record per item (title, SKU, price, quantity, condition, photos), with a per-store "list it here" checkbox and optional per-store price.
- **Sync:** saving an item creates, updates, or ends its listing on every ticked store. Problems are shown in plain language on the item and in the Activity log.
- **Sales:** when an item sells on one store, its quantity drops and the other stores are updated, or the item is ended everywhere if none are left. Sales arrive from Etsy's `order.paid` webhook within seconds, and a check every 5 minutes (`/api/cron/check-sales`) picks up eBay orders and anything a webhook missed. Each order line is counted once, and a sale of more than was in stock is flagged as an oversell.
- **eBay compliance:** the Marketplace Account Deletion endpoint eBay requires before it issues production keys.

## Stack

Next.js 16 (App Router, TypeScript), Postgres with Drizzle ORM, Tailwind CSS, Vitest.

## Running it locally

1. Install Node 22+ and Postgres.
2. `npm install`
3. Copy `.env.example` to `.env` and fill it in. `ENCRYPTION_KEY` comes from `openssl rand -base64 32`.
4. `npm run db:migrate`
5. `npm run dev`, then open http://localhost:3000

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

- Step 4: real-account testing, photo uploads, category search for eBay and Etsy, verifying signatures on eBay deletion notices, billing, hosting, Etsy Commercial Access.

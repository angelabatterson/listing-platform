# Listing Sync

A SaaS for resellers: keep one inventory, choose which marketplaces each item appears on, and keep every store in sync. When an item sells in one place it comes down everywhere else.

Only marketplaces with official public APIs are supported. eBay is built first. Etsy is next.

## What's here

- **Accounts:** sign up, log in, one workspace per client business.
- **Stores:** connect eBay through eBay's own sign-in. Tokens are encrypted at rest (AES-256-GCM).
- **Inventory:** a master record per item (title, SKU, price, quantity, condition, photos), with a per-store "list it here" checkbox and optional per-store price.
- **Sync:** saving an item creates, updates, or ends its eBay listing via the Sell Inventory API. Problems are shown in plain language on the item and in the Activity log.
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

## Checks

```
npm run typecheck
npm run lint
npm test
```

## Roadmap

- Step 3: Etsy connection, sale notifications from eBay and Etsy, a background job queue, and scheduled reconciliation so quantities never drift.
- Step 4: real-account testing, photo uploads, eBay category search, verifying signatures on eBay deletion notices, billing, hosting, Etsy Commercial Access.

@AGENTS.md

# Listing Sync

- Every query must be scoped to the signed-in user's `organizationId`; use `requireUser()` from `src/lib/auth.ts`.
- Marketplace integrations implement `MarketplaceAdapter` (`src/lib/marketplaces/types.ts`) and are registered in `src/lib/marketplaces/index.ts`.
- Marketplace tokens are only stored encrypted (`encrypt`/`decrypt` in `src/lib/crypto.ts`).
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit the migration.
- Before pushing: `npm run typecheck && npm run lint && npm test`. Set `TEST_DATABASE_URL` to a migrated scratch Postgres database to include the database tests (they wipe it).

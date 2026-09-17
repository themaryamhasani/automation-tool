---
name: forward-migration
description: >-
  Add a forward-only PostgreSQL migration under database/ for automation-tool
  domain schemas (iam/catalog/exec/source/cde/audit). Use when adding tables,
  columns, indexes, or binding DDL. Never reverse or rewrite applied migrations.
---

# Forward migration

## Steps

1. List `database/*.sql` and take the next numeric prefix (`018`, `019`, …).
2. Create `database/NNN_short_snake_name.sql` with idempotent SQL where possible (`IF NOT EXISTS`, careful `ALTER`).
3. Keep tables in the correct domain schema (`iam`, `catalog`, `exec`, `source`, `cde`, `audit`). Use `shared/db/search-path.cjs` mentally — app code relies on search_path, not `public` dumps.
4. Update shared helpers if needed (`shared/db/bindings.cjs`, `run-store.cjs`, …).
5. Update architecture / data-model / binding tests that assert schema shape.
6. Run locally: `npm run db:setup` then relevant `node --test tests/platform/...` (or `npm test`).
7. Do **not** rewrite earlier migration files to fix history — add a new forward migration.

## Forbidden

- `DROP` of core tables without explicit user approval
- `db:import` from `SOURCE_DATABASE_URL` / UTMS unless user asked
- Printing DB passwords from `.env`

## Coordinate

- Structure / create-run impact → `architecture-guardian` / `run-pipeline-engineer`
- Auth tables → `auth-crypto-guardian`
- Verification → skill `platform-verify` / agent `platform-verifier`

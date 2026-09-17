---
name: platform-verify
description: >-
  Choose and run the correct automation-tool verification gates (targeted node
  tests, npm test, npm run verify, test:ui, verify:extension). Use whenever
  finishing a feature/fix, after multi-module edits, or when CI-equivalent
  proof is needed. Do not use for credentialed live-check unless the user asked.
---

# Platform verify

## When to use

After code changes in this repo, or when asked to “verify”, “run tests”, or “make sure CI would pass”.

## Policy

1. Prefer the **smallest gate** that still proves the blast radius.
2. Default offline. Never run `node scripts/live-check.cjs` unless the user explicitly requested live/credentialed verification.
3. Never print `.env` secrets while diagnosing failures.

## Gate ladder

| Blast radius | Command |
|--------------|---------|
| One known contract file | `node --test path/to/file.test.cjs` |
| API/shared/runner/tests contracts | `npm test` (or `node scripts/run-tests.cjs` after workspace vitest if only node suites) |
| Cross-cutting / release-like | `npm run verify` |
| Login / run / navigation UI | `npm run db:seed` (if needed) then `npm run test:ui` |
| Extension package surface | `npm run verify:extension` |

CI reference (`.github/workflows/ci.yml`): `npm ci` → `db:setup` → `verify` → seed → Playwright chromium → `test:ui`.

## Suite map

- `tests/platform/*.test.cjs` — architecture, auth, runs, extension, reports, phases
- `tests/approaches/*.test.cjs` — CDE/IS/Git/ZIP/bindings/sessions
- `tests/packs/*.test.cjs` — pack contracts/scaffold/tavan
- `apps/web` vitest / `apps/extension` vitest via workspace `npm test`

## Report format

Return to the parent/user:

1. What ran
2. Pass/fail
3. First failing assertion + file
4. Suggested owning subagent (`architecture-guardian`, `run-pipeline-engineer`, …)

## Persian UX note / یادداشت

If UI smoke fails on copy, expected strings are often Persian RTL — do not “fix” by translating to English unless the product already did.

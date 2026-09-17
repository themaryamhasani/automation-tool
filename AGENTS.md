# AGENTS.md — Automation Tool

Shared project context for the main Cursor agent and project subagents under `.cursor/agents/`.
Do not duplicate this whole file into every subagent; reference it and stay role-focused.

| Layer | Path |
|-------|------|
| Rules | `.cursor/rules/` |
| Skills | `.cursor/skills/` |
| Agents | `.cursor/agents/` |
| Hooks | `.cursor/hooks.json` |

**Orchestration:** the **main agent** is the lead orchestrator (skill `agent-orchestration`). There is no separate orchestrator subagent.

## Product

Standalone Playwright / multi-tool automation management platform (Persian RTL UI).
Independent of UTMS: never reintroduce `@utms/`, `UTMS-MASTER`, or parent-app imports (enforced by `tests/platform/architecture.test.cjs`).

## Layout

| Path | Role |
|------|------|
| `apps/web` | React 19 + Vite + Tailwind; RTL Persian operator UI |
| `apps/api` | Express REST; auth; approaches; create-run; CDE; extension pairing |
| `apps/runner` | Claims runs from Postgres; executes tools; artifacts |
| `apps/extension` | Chrome MV3 recorder (`playwright-crx`); pair → save → optional run |
| `shared/` | Crypto, session cookie, DB helpers, tool options, bindings, IS paths |
| `database/` | Forward SQL migrations (`001`…); domain schemas |
| `tests/{platform,approaches,packs}` | Node test suites via `scripts/run-tests.cjs` |
| `scripts/` | db setup/seed, pack seeders, UI/extension smoke, verify helpers |
| `scripts/pack-overlays/` | First-class pack content (tavan, medu-camp, …) |
| `docs/` | Runbook, OpenAPI, Chrome Recorder guides |

## Source approaches

`CDE` | `IS` | `GITHUB` | `GIT_EDUS` | `ZIP` — see `shared/approaches/constants.cjs` and README.

IS path helpers: `shared/is/paths.cjs` (`isRoot`, `testRoot`, `docRoot`).

## Tool kinds

`DANGER`, `K6`, `PLAYWRIGHT`, `VITEST`, `BIOME`, `GITLEAKS`, `AUDIT`, `SEMGREP`, `SPECTRAL`, `AXE`.

## Hard architecture rules

1. **One create-run path**: `apps/api/src/runs/create-run.cjs` (+ `runs/routes`, `http.cjs`, approach modules). Do not dump new REST into `server.cjs`.
2. **No god files**: extend existing modules; keep `server.cjs` as wiring.
3. **Domain Postgres schemas**: `iam`, `catalog`, `exec`, `source`, `cde`, `audit` via `shared/db/search-path.cjs` — not a pile of `public` tables.
4. **Lean SQL on hot paths**: no `SELECT r.*` / fat `SELECT *` on list/claim/cancel; no unbounded in-memory logs.
5. **Live UI**: SSE for live ops/run events — not tight polling.
6. **Security**: HttpOnly sessions; Secure in production; never weaken path checks, AST source validation, or encryption-key rules.
7. **Tests travel with the change**: `tests/**/*.test.cjs`; UI smoke `scripts/ui-check.spec.cjs` when login/run/screen paths change; keep architecture contracts green.

## Commands (root)

| Script | Use |
|--------|-----|
| `npm run dev` | api + web + runner |
| `npm test` | extension + web vitest + `scripts/run-tests.cjs` |
| `npm run verify` | lint + typecheck + build + test + package extension |
| `npm run db:setup` | apply forward migrations |
| `npm run db:seed` | seed admin / baseline |
| `npm run test:ui` | Playwright UI smoke (`scripts/ci-ui.cjs`) |
| `npm run verify:extension` | lint/typecheck/test/package extension |
| `node scripts/live-check.cjs` | **credentialed / external** — only when user explicitly asks |

Default agent verification: skill `platform-verify` / agent `platform-verifier`.

## Write boundaries (agreed)

- **Pack overlays** (`scripts/pack-overlays/**`, seed scripts): first-class; edit when the user asks about that pack.
- **External IS tree (`IS_ROOT`)**:
  - Hard write root: `IS_TEST_REL` (default `test`) — same contract as API `assertInside(testRoot, …)`.
  - Preferred content root: `IS_DOC_REL` (default `test/doc`) for packs, flows, scripts, reports.
  - Never modify `services/`, app product code, or anything outside `testRoot`.
  - Do not delete or replace the `test` / `test/doc` roots themselves (`IS_ROOT_PROTECTED`).
- **Migrations**: forward-only `database/NNN_*.sql` (skill `forward-migration`).
- **Secrets**: never read/print `.env` secret values; use `.env.example` for names only.

## Language

- Code, identifiers, commits, agent reasoning: **English**.
- Operator-facing UI strings and API user messages: **Persian (RTL)** where the product already uses Persian.
- Subagent prompts: **bilingual** — English procedure + short Persian notes for UX/copy.

## Agent team (capability matrix)

| Agent | Responsibility | Inputs | Outputs | Parallelize | Depends on |
|-------|----------------|--------|---------|-------------|------------|
| **Main agent** | Intent, classify, graph, integrate, user I/O | user request | shipped change + report | n/a | specialists’ structured results |
| `architecture-guardian` | Module boundaries, create-run path, architecture contracts | task + candidate paths | ownership plan / structural edits | investigate yes | — (often first) |
| `schema-migration-engineer` | Forward SQL, search_path, `shared/db` | schema need | migration path + helper deltas | serialize writers | — before consumers |
| `source-approach-engineer` | CDE/IS/Git/ZIP, packs, bindings | approach scope | approach/pack changes | vs extension if disjoint | schema if DDL |
| `run-pipeline-engineer` | create-run → runner → artifacts → SSE | run/tool scope | pipeline changes | vs packs if disjoint | schema; arch for new tools |
| `chrome-recorder-engineer` | Extension MV3, pairing, AST, storageState | extension scope | extension/API bridge changes | vs packs if disjoint | auth-crypto for crypto |
| `auth-crypto-guardian` | Sessions, tokens, crypto, secrets | trust-boundary scope | review / hardening | review parallel | — for HIGH security |
| `platform-verifier` | Gates & suite placement | blast radius | pass/fail + next owner | **after** writers | implementation done |

Specialists return: Summary / Findings / Files / Decisions / Risks / Verification / Recommendations / Blockers.

## Skills

| Skill | When |
|-------|------|
| `agent-orchestration` | Non-trivial multi-step work (required playbook) |
| `feature-development` | Cross-module features |
| `bug-fix` | Defects / failing tests / stuck runs |
| `security-change` | Auth/crypto/pairing/secrets |
| `platform-verify` | Choosing/running gates |
| `forward-migration` | New `database/NNN_*.sql` |
| `pack-overlay` | Pack content under `scripts/pack-overlays` |

## Main agent keeps

- Trivial edits without subagents
- Task classification, risk, dependency graph, parallelization
- Merging specialist output and final user response
- Human escalation when required by orchestration skill

## Example feature flow

```text
User: feature needing DB + API/run + UI
  → Main: classify Feature+Database, risk MEDIUM/HIGH
  → architecture-guardian (boundaries)
  → schema-migration-engineer (forward SQL)
  → parallel: run-pipeline-engineer (+ thin web by Main)
  → platform-verifier
  → Main reports
```

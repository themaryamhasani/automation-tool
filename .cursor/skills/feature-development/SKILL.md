---
name: feature-development
description: >-
  Multi-surface feature workflow for automation-tool (API/runner/web/extension/DB/packs).
  Use when adding user-visible capability across modules. Follows agent-orchestration
  dependency graphs and ends with platform-verify.
---

# Feature development

1. Read skill `agent-orchestration`; classify Feature (+ other labels); set risk.
2. If structural (new routes, create-run, god-file risk) → `architecture-guardian` first with a short handoff JSON.
3. If schema → `schema-migration-engineer` + skill `forward-migration` **before** code that needs columns.
4. Parallelize disjoint implementers:
   - runs/tools/SSE → `run-pipeline-engineer`
   - CDE/IS/Git/ZIP/packs → `source-approach-engineer` (+ `pack-overlay` if pack content)
   - extension → `chrome-recorder-engineer`
   - auth/crypto → involve `auth-crypto-guardian` (HIGH)
5. Main agent: integrate, Persian RTL UI copy, thin web wiring if no dedicated FE agent.
6. `platform-verifier` / skill `platform-verify` — real commands.
7. On FAIL ≤2 retries to owning specialist; then human.

Do not put new REST into `server.cjs`. One create-run path.

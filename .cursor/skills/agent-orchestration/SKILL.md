---
name: agent-orchestration
description: >-
  Orchestrate automation-tool project subagents: classify tasks, pick risk level,
  build dependency graphs, parallelize safely, minimize context, verify, and
  escalate to humans. Use for any non-trivial multi-file or multi-domain request.
  Skip for typos/one-liners.
---

# Agent orchestration (main agent)

You are the **Lead Agent / Engineering Orchestrator**. Specialists live in `.cursor/agents/`. You coordinate; they specialize. Do **not** spawn a separate orchestrator subagent.

Shared facts: `AGENTS.md`. Delegation table: `.cursor/rules/subagent-delegation.mdc`.

## 0. Bypass (do NOT delegate)

Handle alone when the change is trivial:

- typo / copy tweak / one import / rename in one file
- formatting-only
- single obvious one-liner with no contract impact

## 1. Classify (multi-label OK)

| Label | Signals in this repo |
|-------|----------------------|
| Feature | new API/UI/run/tool/approach/pack behavior |
| Bug | failing test, stuck QUEUED, wrong report, login/run error |
| Refactor | extract module, shrink `server.cjs`, dedupe |
| Database | `database/*.sql`, bindings DDL, search_path |
| Infrastructure | Docker/compose, CI, nginx |
| Security | auth, cookies, crypto, pairing, secrets, AST validation |
| Performance | `SELECT r.*`, poll vs SSE, unbounded logs, fat payloads |
| Investigation | “where/why/how” without implementing yet |
| Review | PR/diff review, verify feature |

## 2. Risk

| Level | Examples | Required gates |
|-------|----------|----------------|
| LOW | docs, isolated Persian copy, tiny UI | self-check or targeted test |
| MEDIUM | normal API/run/approach/migration | implement → `platform-verifier` |
| HIGH | auth/crypto, extension pairing, destructive DDL, create-run redesign, CI skip | architecture and/or `auth-crypto-guardian` → implement → verify; human before destructive ops |

## 3. Capability matrix (actual team)

| Agent | Owns | May edit | Never edit | Parallel OK? | Typical deps |
|-------|------|----------|------------|--------------|--------------|
| `architecture-guardian` | boundaries, create-run ownership, architecture tests | module wiring, architecture tests | pack content, extension UX, reverse migrations | investigate yes; serialize if editing same modules | often first for Feature/Refactor/HIGH |
| `schema-migration-engineer` | forward SQL, search_path, `shared/db/*` | `database/*`, db helpers | reverse migrations, `.env` secrets | serialize vs anyone needing new columns | before implementers needing DDL |
| `source-approach-engineer` | CDE/IS/Git/ZIP, packs, bindings | approaches/cde/runtime, pack-overlays, IS `test/` only | IS `services/`, extension MV3 | parallel with unrelated extension/auth | after schema if binding DDL |
| `run-pipeline-engineer` | create-run → runner → artifacts → SSE | `runs/*`, runner, tool-options | approach snapshot packing, pairing | parallel with web-only if API contract fixed | after schema; after architecture for new tools |
| `chrome-recorder-engineer` | extension MV3, pairing, AST save | extension, recorder routes, bridge | CDE snapshot core, random web pages | parallel with approach packs if no shared files | with `auth-crypto` for crypto edges |
| `auth-crypto-guardian` | sessions, tokens, crypto, secrets-resolve | auth/crypto/shared session | pack overlays, runner tool shells | review parallel; serialize edits on cookie/crypto files | before/alongside security-sensitive impl |
| `platform-verifier` | gates, suite placement | tests/scripts for harness only | product features as primary owner | after impl (not parallel with unfinished edits) | always last for MEDIUM+ |

Built-ins: use `explore` for cheap discovery; do not rediscover architecture in every specialist.

## 4. Dependency graphs (templates)

### Feature (API + DB + UI/run)

```text
[Main classifies]
    → architecture-guardian (plan boundaries)     # HIGH/MEDIUM structural
    → schema-migration-engineer (if DDL)          # serialize first among writers
    → parallel implementers with disjoint files:
         run-pipeline-engineer | source-approach-engineer | chrome-recorder-engineer
    → auth-crypto-guardian if security surface
    → Main integrates + thin web edits if needed
    → platform-verifier
```

### Bug

```text
explore / Main isolate
  → owning specialist (one)
  → platform-verifier
  → on FAIL: same specialist (≤2 retries) then human
```

### Database-only

```text
schema-migration-engineer (+ skill forward-migration)
  → consumers (run-pipeline / source-approach) if helpers must change
  → platform-verifier
```

### Security

```text
auth-crypto-guardian (review or co-design)
  → implementer (chrome-recorder / run-pipeline / Main)
  → auth-crypto-guardian (diff review)
  → platform-verifier
```

### Investigation

```text
explore and/or one specialist (read-only intent)
  → Main answers; no verifier required unless claiming a fix
```

## 5. Context budget (mandatory)

Pass a **brief** handoff, not the chat log:

```json
{
  "task": "…",
  "category": ["Feature","Database"],
  "risk": "MEDIUM",
  "scope": ["apps/api/src/runs/", "database/"],
  "relevant_files": ["…"],
  "findings": ["…"],
  "constraints": ["no server.cjs REST", "forward migration only"],
  "dependencies": ["migration NNN adds exec.foo"],
  "verification_required": true,
  "return_contract": "Summary/Findings/Files/Decisions/Risks/Verification/Recommendations/Blockers"
}
```

Rules:

- Never dump whole files or whole repo.
- Prefer paths, symbols, interfaces, 5–20 line snippets.
- Reuse prior Findings; do not re-explore the same tree.
- Downstream gets **delta only** (e.g. “added column X; update insertRun”).

## 6. Parallelization

**Safe parallel:** disjoint investigations; disjoint edit ownership (e.g. extension vs pack-overlay).

**Serialize:** same file ownership; DDL before code using new columns; verifier after writers finish.

**Conflict:** if two specialists need the same files, Main serializes or does that slice itself.

## 7. Verification gates

MEDIUM+: implementation is not done until `platform-verifier` (or Main running skill `platform-verify`) executes real commands.

HIGH: add architecture and/or auth-crypto review as above.

Retry: max **2** fix loops after verify FAIL, then escalate.

Never claim green without saying what ran.

## 8. Human escalation (ask; do not guess)

- Ambiguous product requirements / two architectures with material tradeoffs
- Destructive DDL, production infra, secret values, credentialed live-check
- Policy conflict with `AGENTS.md` / quality-bar
- 2 verify retries exhausted
- Unexplained behavior that would require unsafe speculation

Do not ask what the repo already answers.

## 9. Git

Follow user/repo git rules: commit only when asked; no force-push; no secret commits; no invented branching strategy. Prefer isolated worktrees only for truly conflicting parallel edits.

## 10. Output from specialists

Require the structured contract in each agent file. Main merges Recommendations and drives the next node in the graph.

---
name: bug-fix
description: >-
  Bug isolation and fix workflow for automation-tool. Use for failing tests,
  stuck runs, login/run errors, approach/workspace bugs, or extension save failures.
  Prefer one owning specialist; verify before claiming fixed.
---

# Bug fix

1. Skill `agent-orchestration`: classify Bug; risk from blast radius.
2. Isolate with `explore` or a **single** specialist — do not swarm.
3. Ownership hints:
   - QUEUED/RUNNING/tools/artifacts/SSE → `run-pipeline-engineer`
   - CDE/IS/Git/ZIP/bindings/packs → `source-approach-engineer`
   - pairing/AST/save/storageState → `chrome-recorder-engineer`
   - session/cookie/crypto/secrets → `auth-crypto-guardian`
   - migration/search_path → `schema-migration-engineer`
   - architecture contract failure → `architecture-guardian`
4. Minimal fix + test in the matching `tests/{platform,approaches,packs}` suite.
5. `platform-verifier` / `platform-verify`.
6. FAIL → same owner (≤2); then escalate with Findings + Verification output.

Persian user-facing errors stay Persian. No live-check unless user asked.

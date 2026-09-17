---
name: security-change
description: >-
  Security-sensitive change workflow for auth, cookies, encryption, extension
  pairing, secrets-resolve, and AST credential rules. Use for HIGH-risk security
  work; requires auth-crypto-guardian and verification.
---

# Security change

Risk defaults to **HIGH**.

1. Skill `agent-orchestration` handoff with constraints (HttpOnly/Secure, no secret logging, fail-closed secrets).
2. `auth-crypto-guardian` **before** weakening or redesigning trust boundaries.
3. Implement via owning surface:
   - extension pairing/storageState → `chrome-recorder-engineer` (+ auth-crypto)
   - sessions/API tokens/OIDC/TOTP → auth routes + `auth-crypto-guardian`
   - CDE/runtime encryption → auth-crypto + relevant approach/run owners
4. Second pass: `auth-crypto-guardian` reviews the diff for convenience bypasses.
5. `platform-verifier` on auth/crypto/extension suites (skill `platform-verify`).
6. Human approval for: disabling Secure cookies, lowering key minimums, embedding credentials in specs, production secret rotation, credentialed live-check.

Never print `.env` secrets. Prefer `.env.example` names only.

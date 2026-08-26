# Production runbook — Automation Tool

## Scope

This runbook covers operating the standalone automation platform (API, web, runner, Postgres) in production after Phase 3 maturity features (2FA/SSO, object storage, Vault, analytics).

## Pre-flight checklist

1. Postgres database `automation-tool` migrated (`npm run db:setup`).
2. Strong secrets set:
   - `CDE_SESSION_ENCRYPTION_KEY`
   - `RUNTIME_SESSION_ENCRYPTION_KEY`
   - session cookie Secure in production (`NODE_ENV=production`, do not set `COOKIE_SECURE=0`).
3. At least one ADMIN user seeded; API tokens created from Settings for CI.
4. Runner(s) healthy: `GET /api/health/detail` (ADMIN) shows DB + runner_settings.enabled.
5. Optional Phase 3:
   - `OIDC_ENABLED=1` with issuer/client/redirect configured.
   - `OBJECT_STORAGE_BACKEND=s3` with bucket credentials when disk is not acceptable.
   - `VAULT_ADDR` + `VAULT_TOKEN` when environment `secret_references` use `vault:path#FIELD`.

## Deploy

```bash
npm ci
npm run db:setup
npm run build
docker compose up -d   # or systemd units for api/web/runner
```

Health:

- `GET /api/health` must return 200.
- `GET /api/platform/maturity` shows feature flags.
- `GET /api/openapi.json` serves the platform contract.

## Auth & access

- Prefer OIDC SSO for operators when available (`/api/auth/sso/start`).
- Enable TOTP 2FA per user from Settings (setup → confirm code).
- CI uses API tokens (`Authorization: Bearer atk_…`) with least privilege scopes.
- Never commit `.env`, Vault tokens, or encryption keys.

## Secrets

Environment `secret_references` map target ENV → source:

- Direct: `"TARGET_ENV": "RUNNER_ENV_NAME"`
- Vault: `"TARGET_ENV": "vault:secret/data/app/db#password"` (or `vault:app/db#password` with `VAULT_KV_MOUNT`)

Runner fails closed if a referenced secret is missing.

## Artifacts & retention

- Default: files under `ARTIFACT_ROOT`.
- With S3 backend, runner uploads after write; download hydrates from object storage if local file is gone.
- Retention worker purges old runs/artifacts/snapshots (`ARTIFACT_RETENTION_DAYS`).

## Quality gates & SCM status (Phase 4)

1. Define a project gate (`/api/projects/:id/gates`) with max failed tests / fail rate.
2. Queue runs with `commitSha` (+ optional `gitRef` / `prNumber`) for GitHub/GIT_EDUS.
3. On completion, the platform evaluates the gate, stores `gate_status`, and posts commit status when a source token exists.
4. CI can poll `GET /api/pipeline/gate?projectId=&commitSha=` (200 = pass, 409 = fail).

Ops live view: `/dashboard` (SSE `/api/ops/events`) shows queue, runner fleet, and CDE sessions.

---

## Incidents

| Symptom | Check | Action |
|---------|--------|--------|
| Login 401 after SSO | User provisioned with matching email? | Create/link user, retry |
| Runs stuck QUEUED | `runner_settings.enabled`, runner process, `RUNNER_TAGS` mismatch | Start runner / clear tags |
| Snapshot PREPARING forever | CDE session + snapshot worker logs | Reconnect CDE, cancel stuck run |
| Artifact 410 | Disk purged, S3 misconfigured | Restore from S3 or re-run |
| Vault errors on run | Token/path/field | Fix reference or renew token |
| High flaky rate | `/analytics` or quality report | Quarantine suite item / fix test |

## Rollback

1. Stop scheduler impact by disabling suite schedules or setting `runner_settings.enabled=false`.
2. Redeploy previous image/tag.
3. Do **not** reverse migrations unless explicitly planned; prefer forward fixes.

## Contacts

Keep on-call rotation and IdP/Vault admin contacts outside this repo.

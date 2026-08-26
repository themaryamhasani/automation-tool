-- Phase 5: runtime_sessions keyed by pack within an environment
-- (workspace m-edus is shared across CDE packs; old PK (user, env) collided).

ALTER TABLE exec.runtime_sessions
  ADD COLUMN IF NOT EXISTS pack_key varchar(255) NOT NULL DEFAULT '';

ALTER TABLE exec.runtime_sessions
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES catalog.projects(id) ON DELETE CASCADE;

-- Backfill project_id from the environment ownership.
UPDATE exec.runtime_sessions rs
   SET project_id = e.project_id
  FROM catalog.environments e
 WHERE e.id = rs.environment_id
   AND rs.project_id IS NULL;

-- Prefer pack_key already stored inside encrypted state when present (best-effort; leave '' if decrypt fails).
-- Application layer always writes pack_key explicitly after this migration.

ALTER TABLE exec.runtime_sessions
  DROP CONSTRAINT IF EXISTS runtime_sessions_pkey;

ALTER TABLE exec.runtime_sessions
  ADD CONSTRAINT runtime_sessions_pkey PRIMARY KEY (user_id, environment_id, pack_key);

CREATE INDEX IF NOT EXISTS runtime_sessions_project_idx
  ON exec.runtime_sessions (user_id, project_id, pack_key)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS runtime_sessions_expires_idx
  ON exec.runtime_sessions (expires_at);

INSERT INTO platform.schema_migrations (version) VALUES ('015_runtime_session_scope') ON CONFLICT DO NOTHING;

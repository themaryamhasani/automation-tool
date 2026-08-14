ALTER TABLE cde_project_mappings ADD COLUMN IF NOT EXISTS test_repo_name text NOT NULL DEFAULT 'automation_tool_test_files';
ALTER TABLE cde_project_mappings ADD COLUMN IF NOT EXISTS test_pack_id text;

UPDATE cde_project_mappings
   SET test_pack_id = coalesce(test_pack_id, 'playwright/' || project_key)
 WHERE test_pack_id IS NULL;

CREATE TABLE IF NOT EXISTS cde_source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  initiating_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','MATERIALIZING','READY','FAILED','PURGED')),
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash varchar(64),
  file_count integer NOT NULL DEFAULT 0,
  error_code varchar(120),
  error_message text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cde_source_snapshots_status_idx ON cde_source_snapshots (status, created_at);
CREATE INDEX IF NOT EXISTS cde_source_snapshots_expiry_idx ON cde_source_snapshots (expires_at) WHERE purged_at IS NULL;

CREATE TABLE IF NOT EXISTS cde_snapshot_files (
  snapshot_id uuid NOT NULL REFERENCES cde_source_snapshots(id) ON DELETE CASCADE,
  path text NOT NULL,
  encrypted_source text NOT NULL,
  source_hash varchar(64) NOT NULL,
  repository_type varchar(40) NOT NULL,
  repo_name text,
  pack_id text,
  version_id varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, path)
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS cde_snapshot_id uuid REFERENCES cde_source_snapshots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS runs_cde_snapshot_idx ON runs (cde_snapshot_id);

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check CHECK (status IN ('PREPARING','QUEUED','RUNNING','PASSED','FAILED','ERROR','CANCEL_REQUESTED','CANCELLED'));

INSERT INTO schema_migrations (version) VALUES ('003_cde_snapshots') ON CONFLICT DO NOTHING;

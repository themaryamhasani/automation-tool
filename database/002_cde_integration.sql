CREATE TABLE IF NOT EXISTS cde_sessions (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  encrypted_state text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cde_sessions_expires_idx ON cde_sessions (expires_at);

CREATE TABLE IF NOT EXISTS cde_project_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  service_id varchar(255) NOT NULL DEFAULT 'cde.edus.ir',
  project_key varchar(255) NOT NULL,
  web_ui_repo_name text,
  data_service_repo_name text,
  api_module_repo_name text,
  message_consumer_repo_name text,
  enabled boolean NOT NULL DEFAULT true,
  last_validation_status varchar(64),
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cde_project_mappings_key_idx ON cde_project_mappings (project_key, enabled);

CREATE TABLE IF NOT EXISTS cde_branch_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_type varchar(40) NOT NULL,
  repo_name text NOT NULL,
  pack_id text NOT NULL,
  branch_kind varchar(20) NOT NULL CHECK (branch_kind IN ('PUBLIC', 'PERSONAL')),
  branch_rand_id varchar(255),
  branch_index integer,
  last_seen_version_id varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, repository_type, repo_name, pack_id)
);

ALTER TABLE test_files ADD COLUMN IF NOT EXISTS cde_project_key varchar(255);
ALTER TABLE test_files ADD COLUMN IF NOT EXISTS cde_binding jsonb;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS cde_project_key varchar(255);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS cde_manifest jsonb;

INSERT INTO schema_migrations (version) VALUES ('002_cde_integration') ON CONFLICT DO NOTHING;

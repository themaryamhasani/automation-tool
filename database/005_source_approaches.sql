ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_approach varchar(20) NOT NULL DEFAULT 'CDE';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_source_approach_check;
ALTER TABLE projects ADD CONSTRAINT projects_source_approach_check
  CHECK (source_approach IN ('CDE', 'IS', 'GITHUB', 'GIT_EDUS', 'ZIP'));

CREATE TABLE IF NOT EXISTS user_source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL CHECK (provider IN ('GITHUB', 'GIT_EDUS')),
  username varchar(255),
  display_name varchar(255),
  encrypted_state text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS user_source_connections_user_idx ON user_source_connections (user_id, provider);

CREATE TABLE IF NOT EXISTS project_source_bindings (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  source_approach varchar(20) NOT NULL CHECK (source_approach IN ('CDE', 'IS', 'GITHUB', 'GIT_EDUS', 'ZIP')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_sync_status varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS source_approach varchar(20) NOT NULL DEFAULT 'CDE';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS tool_kind varchar(20) NOT NULL DEFAULT 'PLAYWRIGHT';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS tool_target text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS pack_id varchar(40);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS flow_id varchar(40);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS report_paths jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_approach_check;
ALTER TABLE runs ADD CONSTRAINT runs_source_approach_check
  CHECK (source_approach IN ('CDE', 'IS', 'GITHUB', 'GIT_EDUS', 'ZIP'));
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_tool_kind_check;
ALTER TABLE runs ADD CONSTRAINT runs_tool_kind_check
  CHECK (tool_kind IN (
    'PLAYWRIGHT', 'DANGER', 'K6', 'VITEST',
    'BIOME', 'GITLEAKS', 'AUDIT', 'SEMGREP', 'SPECTRAL', 'AXE'
  ));

CREATE INDEX IF NOT EXISTS runs_approach_tool_idx ON runs (source_approach, tool_kind, requested_at DESC);

INSERT INTO schema_migrations (version) VALUES ('005_source_approaches') ON CONFLICT DO NOTHING;

-- Phase 3: pack/runtime targets as catalog data (replaces hard-coded APP_TARGETS).

CREATE TABLE IF NOT EXISTS catalog.project_targets (
  pack_key varchar(120) PRIMARY KEY,
  project_id uuid REFERENCES catalog.projects(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  preferred_origin text,
  login_path text,
  app_path text,
  project_service_id text,
  use_origin_host_as_service_id boolean NOT NULL DEFAULT false,
  auth_mode varchar(64) NOT NULL DEFAULT 'devlogin',
  auth_profiles jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_landings jsonb NOT NULL DEFAULT '{}'::jsonb,
  api_fixtures jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_targets_project_idx
  ON catalog.project_targets (project_id)
  WHERE project_id IS NOT NULL;

INSERT INTO platform.schema_migrations (version) VALUES ('013_project_targets') ON CONFLICT DO NOTHING;

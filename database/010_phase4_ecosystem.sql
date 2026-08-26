INSERT INTO schema_migrations (version) VALUES ('010_phase4_ecosystem') ON CONFLICT DO NOTHING;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS commit_sha varchar(64);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS git_ref varchar(255);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS pr_number integer;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS gate_status varchar(20);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS gate_summary jsonb;

CREATE INDEX IF NOT EXISTS runs_commit_sha_idx ON runs (commit_sha) WHERE commit_sha IS NOT NULL;

CREATE TABLE IF NOT EXISTS quality_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  max_failed_tests integer,
  max_fail_rate numeric(6,4),
  require_status varchar(24) NOT NULL DEFAULT 'PASSED',
  block_on_flaky boolean NOT NULL DEFAULT false,
  max_flaky_fail_rate numeric(6,4) DEFAULT 0.5,
  post_scm_status boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS quality_gate_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id uuid REFERENCES quality_gates(id) ON DELETE SET NULL,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  passed boolean NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quality_gate_results_run_idx ON quality_gate_results (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scm_status_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL,
  commit_sha varchar(64) NOT NULL,
  state varchar(20) NOT NULL,
  target_url text,
  context_name varchar(120) NOT NULL,
  response_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scm_status_posts_run_idx ON scm_status_posts (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runner_instances (
  runner_id varchar(255) PRIMARY KEY,
  hostname varchar(255),
  tags text[] NOT NULL DEFAULT '{}',
  concurrency integer NOT NULL DEFAULT 1,
  active_runs integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runner_instances_seen_idx ON runner_instances (last_seen_at DESC);

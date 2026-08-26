INSERT INTO schema_migrations (version) VALUES ('008_phase2_automation') ON CONFLICT DO NOTHING;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS suite_id uuid;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS trigger_source varchar(30) NOT NULL DEFAULT 'manual';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS runner_tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS runs_queue_priority_idx ON runs (status, priority DESC, requested_at)
  WHERE status IN ('QUEUED', 'PREPARING');

CREATE TABLE IF NOT EXISTS test_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  description text,
  environment_id uuid REFERENCES environments(id) ON DELETE SET NULL,
  schedule_cron varchar(120),
  schedule_timezone varchar(80) NOT NULL DEFAULT 'Asia/Tehran',
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  runner_tags text[] NOT NULL DEFAULT '{}',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS test_suites_schedule_idx ON test_suites (enabled, next_run_at)
  WHERE enabled = true AND schedule_cron IS NOT NULL;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_suite_fk;
ALTER TABLE runs ADD CONSTRAINT runs_suite_fk FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  token_prefix varchar(16) NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['runs:create', 'runs:read']::text[],
  project_ids uuid[],
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS api_tokens_user_active_idx ON api_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  url text NOT NULL,
  secret text,
  events text[] NOT NULL DEFAULT ARRAY['run.completed']::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  kind varchar(30) NOT NULL CHECK (kind IN ('EMAIL', 'SLACK', 'TEAMS', 'WEBHOOK')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  events text[] NOT NULL DEFAULT ARRAY['run.failed', 'run.error']::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_channels_project_name_idx
  ON notification_channels (project_id, name) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notification_channels_global_name_idx
  ON notification_channels (name) WHERE project_id IS NULL;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid REFERENCES webhooks(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES notification_channels(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL,
  response_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_run_idx ON webhook_deliveries (run_id, created_at DESC);

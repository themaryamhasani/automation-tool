CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(255) NOT NULL,
  email varchar(320),
  phone_number varchar(32),
  password_hash text NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('ADMIN', 'OPERATOR', 'VIEWER')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_required CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone_number) WHERE phone_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  code varchar(80) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_code_unique ON projects (lower(code));

CREATE TABLE IF NOT EXISTS user_projects (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  base_url text NOT NULL,
  api_base_url text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS test_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_path text NOT NULL DEFAULT 'tests',
  file_name varchar(255) NOT NULL,
  description text,
  source_code text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, folder_path, file_name)
);
CREATE INDEX IF NOT EXISTS test_files_project_updated_idx ON test_files (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
  test_file_id uuid REFERENCES test_files(id) ON DELETE SET NULL,
  test_file_path text NOT NULL,
  source_snapshot text NOT NULL,
  browser_projects text[] NOT NULL DEFAULT ARRAY['chromium']::text[],
  headed boolean NOT NULL DEFAULT false,
  workers integer NOT NULL DEFAULT 1 CHECK (workers BETWEEN 1 AND 32),
  retries integer NOT NULL DEFAULT 0 CHECK (retries BETWEEN 0 AND 10),
  max_failures integer,
  trace varchar(40) NOT NULL DEFAULT 'retain-on-failure',
  reporter varchar(20) NOT NULL DEFAULT 'json' CHECK (reporter IN ('html', 'json', 'junit')),
  timeout_seconds integer NOT NULL DEFAULT 120 CHECK (timeout_seconds BETWEEN 5 AND 3600),
  status varchar(24) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCEL_REQUESTED', 'CANCELLED')),
  runner_id varchar(255),
  command text,
  logs text,
  report jsonb,
  total_tests integer,
  passed_tests integer,
  failed_tests integer,
  skipped_tests integer,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_status_requested_idx ON runs (status, requested_at);
CREATE INDEX IF NOT EXISTS runs_project_requested_idx ON runs (project_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind varchar(30) NOT NULL,
  file_name varchar(500) NOT NULL,
  relative_path text NOT NULL,
  mime_type varchar(255) NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_run_idx ON artifacts (run_id);

CREATE TABLE IF NOT EXISTS runner_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  default_timeout_seconds integer NOT NULL DEFAULT 120,
  default_workers integer NOT NULL DEFAULT 1,
  default_retries integer NOT NULL DEFAULT 0,
  default_trace varchar(40) NOT NULL DEFAULT 'retain-on-failure',
  default_reporter varchar(20) NOT NULL DEFAULT 'json',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO runner_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  entity_type varchar(80),
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS import_records (
  source_type varchar(40) NOT NULL,
  source_id text NOT NULL,
  target_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_id)
);

INSERT INTO schema_migrations (version) VALUES ('001_initial') ON CONFLICT DO NOTHING;

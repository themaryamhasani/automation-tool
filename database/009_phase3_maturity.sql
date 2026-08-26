INSERT INTO schema_migrations (version) VALUES ('009_phase3_maturity') ON CONFLICT DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_provider varchar(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_subject varchar(255);
CREATE UNIQUE INDEX IF NOT EXISTS users_sso_unique
  ON users (sso_provider, sso_subject)
  WHERE sso_provider IS NOT NULL AND sso_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('TOTP', 'SSO')),
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_challenges_user_idx ON auth_challenges (user_id, expires_at)
  WHERE consumed_at IS NULL;
ALTER TABLE auth_challenges ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS storage_backend varchar(20) NOT NULL DEFAULT 'disk';
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS object_key text;

ALTER TABLE cde_source_snapshots ADD COLUMN IF NOT EXISTS storage_backend varchar(20) NOT NULL DEFAULT 'db';
ALTER TABLE cde_source_snapshots ADD COLUMN IF NOT EXISTS object_prefix text;

CREATE TABLE IF NOT EXISTS flaky_test_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_key varchar(500) NOT NULL,
  test_file_path text NOT NULL,
  tool_kind varchar(40),
  pack_id varchar(255),
  flow_id varchar(80),
  pass_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  total_runs integer NOT NULL DEFAULT 0,
  fail_rate numeric(6,4) NOT NULL DEFAULT 0,
  last_status varchar(24),
  last_run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, test_key)
);
CREATE INDEX IF NOT EXISTS flaky_test_stats_rate_idx ON flaky_test_stats (project_id, fail_rate DESC);

CREATE TABLE IF NOT EXISTS platform_documents (
  id varchar(80) PRIMARY KEY,
  title varchar(255) NOT NULL,
  kind varchar(40) NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

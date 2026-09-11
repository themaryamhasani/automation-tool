-- Production Chrome Recorder pairing and rotatable extension credentials.

CREATE TABLE IF NOT EXISTS iam.extension_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  code_hash varchar(64) NOT NULL UNIQUE,
  project_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extension_pairing_codes_active_idx
  ON iam.extension_pairing_codes (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS iam.extension_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  access_token_hash varchar(64) NOT NULL UNIQUE,
  refresh_token_hash varchar(64) NOT NULL UNIQUE,
  token_prefix varchar(16) NOT NULL,
  project_ids uuid[] NOT NULL DEFAULT '{}',
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  device_id_hash varchar(64),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extension_sessions_user_active_idx
  ON iam.extension_sessions (user_id, refresh_expires_at)
  WHERE revoked_at IS NULL;

INSERT INTO platform.schema_migrations (version)
VALUES ('018_extension_pairing') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS runtime_sessions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  encrypted_state text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, environment_id)
);
CREATE INDEX IF NOT EXISTS runtime_sessions_expires_idx ON runtime_sessions (expires_at);

INSERT INTO schema_migrations (version) VALUES ('007_runtime_sessions') ON CONFLICT DO NOTHING;

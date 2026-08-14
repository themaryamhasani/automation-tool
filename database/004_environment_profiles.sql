ALTER TABLE environments ADD COLUMN IF NOT EXISTS gateway_base_url text;
ALTER TABLE environments ADD COLUMN IF NOT EXISTS secret_references jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE environments ADD COLUMN IF NOT EXISTS available_from timestamptz;
ALTER TABLE environments ADD COLUMN IF NOT EXISTS available_until timestamptz;

ALTER TABLE environments DROP CONSTRAINT IF EXISTS environments_availability_check;
ALTER TABLE environments ADD CONSTRAINT environments_availability_check CHECK (
  available_from IS NULL OR available_until IS NULL OR available_until > available_from
);
CREATE INDEX IF NOT EXISTS environments_availability_idx ON environments (project_id, available_from, available_until);

INSERT INTO schema_migrations (version) VALUES ('004_environment_profiles') ON CONFLICT DO NOTHING;

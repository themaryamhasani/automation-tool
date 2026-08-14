ALTER TABLE runs ALTER COLUMN tool_kind TYPE varchar(32);

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_tool_kind_check;
ALTER TABLE runs ADD CONSTRAINT runs_tool_kind_check
  CHECK (tool_kind IN (
    'PLAYWRIGHT', 'DANGER', 'K6', 'VITEST',
    'BIOME', 'GITLEAKS', 'AUDIT', 'SEMGREP', 'SPECTRAL', 'AXE'
  ));

INSERT INTO schema_migrations (version) VALUES ('006_quality_tools') ON CONFLICT DO NOTHING;

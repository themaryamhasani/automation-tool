-- Phase 6: mark approach workspace projects (ws-*) vs named org systems.

ALTER TABLE catalog.projects
  ADD COLUMN IF NOT EXISTS kind varchar(20) NOT NULL DEFAULT 'NAMED';

ALTER TABLE catalog.projects DROP CONSTRAINT IF EXISTS projects_kind_check;
ALTER TABLE catalog.projects
  ADD CONSTRAINT projects_kind_check CHECK (kind IN ('NAMED', 'WORKSPACE'));

UPDATE catalog.projects
   SET kind = 'WORKSPACE'
 WHERE kind <> 'WORKSPACE'
   AND lower(code) LIKE 'ws-%';

CREATE INDEX IF NOT EXISTS projects_kind_active_idx
  ON catalog.projects (kind, is_active, name);

INSERT INTO platform.schema_migrations (version) VALUES ('016_project_kind') ON CONFLICT DO NOTHING;

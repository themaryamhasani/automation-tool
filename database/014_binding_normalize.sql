-- Phase 4: normalize source bindings into typed child tables (config jsonb becomes a synced mirror).

CREATE TABLE IF NOT EXISTS source.binding_cde (
  project_id uuid PRIMARY KEY REFERENCES source.project_source_bindings(project_id) ON DELETE CASCADE,
  pack_key varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source.binding_is (
  project_id uuid PRIMARY KEY REFERENCES source.project_source_bindings(project_id) ON DELETE CASCADE,
  pack_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source.binding_git (
  project_id uuid PRIMARY KEY REFERENCES source.project_source_bindings(project_id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL CHECK (provider IN ('GITHUB', 'GIT_EDUS')),
  remote_id varchar(255) NOT NULL,
  full_name varchar(512) NOT NULL,
  default_branch varchar(255) NOT NULL DEFAULT 'main',
  html_url text,
  clone_url text,
  bound_by uuid REFERENCES iam.users(id) ON DELETE SET NULL,
  bound_username varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source.binding_zip (
  project_id uuid PRIMARY KEY REFERENCES source.project_source_bindings(project_id) ON DELETE CASCADE,
  root_path text NOT NULL,
  original_name varchar(255),
  file_count integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  extracted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill typed children from legacy free-form config.
INSERT INTO source.binding_cde (project_id, pack_key)
SELECT b.project_id,
       COALESCE(
         NULLIF(b.config->>'packKey', ''),
         NULLIF(b.config->>'projectKey', ''),
         NULLIF(b.config->>'packId', ''),
         'unknown'
       )
  FROM source.project_source_bindings b
 WHERE b.source_approach = 'CDE'
   AND NOT EXISTS (SELECT 1 FROM source.binding_cde c WHERE c.project_id = b.project_id)
ON CONFLICT (project_id) DO NOTHING;

INSERT INTO source.binding_is (project_id, pack_id)
SELECT b.project_id,
       UPPER(COALESCE(NULLIF(b.config->>'packId', ''), 'UNKNOWN'))
  FROM source.project_source_bindings b
 WHERE b.source_approach = 'IS'
   AND NOT EXISTS (SELECT 1 FROM source.binding_is i WHERE i.project_id = b.project_id)
ON CONFLICT (project_id) DO NOTHING;

INSERT INTO source.binding_git (
  project_id, provider, remote_id, full_name, default_branch, html_url, clone_url, bound_by, bound_username
)
SELECT b.project_id,
       b.source_approach,
       COALESCE(NULLIF(b.config->>'remoteId', ''), 'unknown'),
       COALESCE(NULLIF(b.config->>'fullName', ''), 'unknown/unknown'),
       COALESCE(NULLIF(b.config->>'defaultBranch', ''), 'main'),
       NULLIF(b.config->>'htmlUrl', ''),
       NULLIF(b.config->>'cloneUrl', ''),
       CASE
         WHEN COALESCE(b.config->>'boundBy', '') ~* '^[0-9a-f-]{36}$'
           THEN (b.config->>'boundBy')::uuid
         ELSE NULL
       END,
       NULLIF(b.config->>'boundUsername', '')
  FROM source.project_source_bindings b
 WHERE b.source_approach IN ('GITHUB', 'GIT_EDUS')
   AND NOT EXISTS (SELECT 1 FROM source.binding_git g WHERE g.project_id = b.project_id)
ON CONFLICT (project_id) DO NOTHING;

INSERT INTO source.binding_zip (project_id, root_path, original_name, file_count, bytes, extracted_at)
SELECT b.project_id,
       COALESCE(NULLIF(b.config->>'root', ''), ''),
       NULLIF(b.config->>'originalName', ''),
       COALESCE((b.config->>'fileCount')::integer, 0),
       COALESCE((b.config->>'bytes')::bigint, 0),
       CASE
         WHEN COALESCE(b.config->>'extractedAt', '') <> ''
           THEN (b.config->>'extractedAt')::timestamptz
         ELSE NULL
       END
  FROM source.project_source_bindings b
 WHERE b.source_approach = 'ZIP'
   AND COALESCE(b.config->>'root', '') <> ''
   AND NOT EXISTS (SELECT 1 FROM source.binding_zip z WHERE z.project_id = b.project_id)
ON CONFLICT (project_id) DO NOTHING;

-- Drop mismatched child rows left behind by approach switches (idempotent cleanup).
DELETE FROM source.binding_cde c
 WHERE EXISTS (
   SELECT 1 FROM source.project_source_bindings b
    WHERE b.project_id = c.project_id AND b.source_approach <> 'CDE'
 );
DELETE FROM source.binding_is i
 WHERE EXISTS (
   SELECT 1 FROM source.project_source_bindings b
    WHERE b.project_id = i.project_id AND b.source_approach <> 'IS'
 );
DELETE FROM source.binding_git g
 WHERE EXISTS (
   SELECT 1 FROM source.project_source_bindings b
    WHERE b.project_id = g.project_id AND b.source_approach NOT IN ('GITHUB', 'GIT_EDUS')
 );
DELETE FROM source.binding_zip z
 WHERE EXISTS (
   SELECT 1 FROM source.project_source_bindings b
    WHERE b.project_id = z.project_id AND b.source_approach <> 'ZIP'
 );

INSERT INTO platform.schema_migrations (version) VALUES ('014_binding_normalize') ON CONFLICT DO NOTHING;

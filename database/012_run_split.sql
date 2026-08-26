-- Phase 2: split fat run payloads out of exec.runs (queue/list stays narrow).

CREATE TABLE IF NOT EXISTS exec.run_requests (
  run_id uuid PRIMARY KEY REFERENCES exec.runs(id) ON DELETE CASCADE,
  browser_projects text[] NOT NULL DEFAULT ARRAY['chromium']::text[],
  headed boolean NOT NULL DEFAULT false,
  workers integer NOT NULL DEFAULT 1 CHECK (workers BETWEEN 1 AND 32),
  retries integer NOT NULL DEFAULT 0 CHECK (retries BETWEEN 0 AND 10),
  max_failures integer,
  trace varchar(40) NOT NULL DEFAULT 'retain-on-failure',
  reporter varchar(20) NOT NULL DEFAULT 'json',
  timeout_seconds integer NOT NULL DEFAULT 120 CHECK (timeout_seconds BETWEEN 5 AND 3600),
  tool_options jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS exec.run_sources (
  run_id uuid PRIMARY KEY REFERENCES exec.runs(id) ON DELETE CASCADE,
  source_snapshot text NOT NULL DEFAULT '',
  cde_manifest jsonb
);

CREATE TABLE IF NOT EXISTS exec.run_logs (
  run_id uuid PRIMARY KEY REFERENCES exec.runs(id) ON DELETE CASCADE,
  logs text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exec.run_results (
  run_id uuid PRIMARY KEY REFERENCES exec.runs(id) ON DELETE CASCADE,
  report jsonb,
  gate_summary jsonb
);

CREATE TABLE IF NOT EXISTS exec.run_scm (
  run_id uuid PRIMARY KEY REFERENCES exec.runs(id) ON DELETE CASCADE,
  commit_sha varchar(64),
  git_ref varchar(255),
  pr_number integer
);

CREATE INDEX IF NOT EXISTS run_scm_commit_sha_idx ON exec.run_scm (commit_sha) WHERE commit_sha IS NOT NULL;

INSERT INTO exec.run_requests (
  run_id, browser_projects, headed, workers, retries, max_failures, trace, reporter, timeout_seconds
)
SELECT
  id,
  coalesce(browser_projects, ARRAY['chromium']::text[]),
  coalesce(headed, false),
  coalesce(workers, 1),
  coalesce(retries, 0),
  max_failures,
  coalesce(trace, 'retain-on-failure'),
  coalesce(reporter, 'json'),
  coalesce(timeout_seconds, 120)
FROM exec.runs
ON CONFLICT (run_id) DO NOTHING;

INSERT INTO exec.run_sources (run_id, source_snapshot, cde_manifest)
SELECT id, coalesce(source_snapshot, ''), cde_manifest
FROM exec.runs
ON CONFLICT (run_id) DO NOTHING;

INSERT INTO exec.run_logs (run_id, logs, updated_at)
SELECT id, logs, coalesce(updated_at, now())
FROM exec.runs
ON CONFLICT (run_id) DO NOTHING;

INSERT INTO exec.run_results (run_id, report, gate_summary)
SELECT id, report, gate_summary
FROM exec.runs
ON CONFLICT (run_id) DO NOTHING;

INSERT INTO exec.run_scm (run_id, commit_sha, git_ref, pr_number)
SELECT id, commit_sha, git_ref, pr_number
FROM exec.runs
WHERE commit_sha IS NOT NULL OR git_ref IS NOT NULL OR pr_number IS NOT NULL
ON CONFLICT (run_id) DO NOTHING;

ALTER TABLE exec.runs DROP COLUMN IF EXISTS source_snapshot;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS browser_projects;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS headed;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS workers;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS retries;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS max_failures;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS trace;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS reporter;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS timeout_seconds;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS logs;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS report;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS cde_manifest;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS commit_sha;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS git_ref;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS pr_number;
ALTER TABLE exec.runs DROP COLUMN IF EXISTS gate_summary;

INSERT INTO platform.schema_migrations (version) VALUES ('012_run_split') ON CONFLICT DO NOTHING;

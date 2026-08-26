-- Phase 1: split public into domain schemas. Behavior unchanged; search_path resolves names.

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS source;
CREATE SCHEMA IF NOT EXISTS cde;
CREATE SCHEMA IF NOT EXISTS exec;
CREATE SCHEMA IF NOT EXISTS automation;
CREATE SCHEMA IF NOT EXISTS quality;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS audit;

-- iam
ALTER TABLE IF EXISTS public.users SET SCHEMA iam;
ALTER TABLE IF EXISTS public.sessions SET SCHEMA iam;
ALTER TABLE IF EXISTS public.auth_challenges SET SCHEMA iam;
ALTER TABLE IF EXISTS public.api_tokens SET SCHEMA iam;

-- catalog
ALTER TABLE IF EXISTS public.projects SET SCHEMA catalog;
ALTER TABLE IF EXISTS public.user_projects SET SCHEMA catalog;
ALTER TABLE IF EXISTS public.environments SET SCHEMA catalog;
ALTER TABLE IF EXISTS public.test_files SET SCHEMA catalog;

-- source
ALTER TABLE IF EXISTS public.user_source_connections SET SCHEMA source;
ALTER TABLE IF EXISTS public.project_source_bindings SET SCHEMA source;

-- cde
ALTER TABLE IF EXISTS public.cde_sessions SET SCHEMA cde;
ALTER TABLE IF EXISTS public.cde_project_mappings SET SCHEMA cde;
ALTER TABLE IF EXISTS public.cde_branch_selections SET SCHEMA cde;
ALTER TABLE IF EXISTS public.cde_source_snapshots SET SCHEMA cde;
ALTER TABLE IF EXISTS public.cde_snapshot_files SET SCHEMA cde;

-- exec
ALTER TABLE IF EXISTS public.runs SET SCHEMA exec;
ALTER TABLE IF EXISTS public.artifacts SET SCHEMA exec;
ALTER TABLE IF EXISTS public.runner_settings SET SCHEMA exec;
ALTER TABLE IF EXISTS public.runner_instances SET SCHEMA exec;
ALTER TABLE IF EXISTS public.runtime_sessions SET SCHEMA exec;

-- automation
ALTER TABLE IF EXISTS public.test_suites SET SCHEMA automation;
ALTER TABLE IF EXISTS public.webhooks SET SCHEMA automation;
ALTER TABLE IF EXISTS public.webhook_deliveries SET SCHEMA automation;
ALTER TABLE IF EXISTS public.notification_channels SET SCHEMA automation;

-- quality
ALTER TABLE IF EXISTS public.quality_gates SET SCHEMA quality;
ALTER TABLE IF EXISTS public.quality_gate_results SET SCHEMA quality;
ALTER TABLE IF EXISTS public.flaky_test_stats SET SCHEMA quality;
ALTER TABLE IF EXISTS public.scm_status_posts SET SCHEMA quality;

-- platform (schema_migrations last among moves so prior migrations still recorded in public until now)
ALTER TABLE IF EXISTS public.platform_documents SET SCHEMA platform;
ALTER TABLE IF EXISTS public.import_records SET SCHEMA platform;
ALTER TABLE IF EXISTS public.schema_migrations SET SCHEMA platform;

-- audit
ALTER TABLE IF EXISTS public.audit_logs SET SCHEMA audit;

SET search_path TO catalog, exec, iam, source, cde, automation, quality, platform, audit, public;

DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path TO catalog, exec, iam, source, cde, automation, quality, platform, audit, public',
    current_database()
  );
END $$;

INSERT INTO platform.schema_migrations (version) VALUES ('011_domain_schemas') ON CONFLICT DO NOTHING;

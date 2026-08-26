/**
 * Phase-2 run layout: narrow exec.runs + child tables for fat payloads.
 * Unqualified names rely on domain search_path (catalog/exec/…).
 */

const RUN_CHILD_JOINS = `
  LEFT JOIN run_requests req ON req.run_id = r.id
  LEFT JOIN run_sources src ON src.run_id = r.id
  LEFT JOIN run_logs lg ON lg.run_id = r.id
  LEFT JOIN run_results res ON res.run_id = r.id
  LEFT JOIN run_scm scm ON scm.run_id = r.id`;

const RUN_CORE_RETURNING = `
  id, project_id, environment_id, test_file_id, test_file_path, status, runner_id, command,
  total_tests, passed_tests, failed_tests, skipped_tests, requested_by, requested_at,
  started_at, completed_at, duration_ms, last_heartbeat_at, source_approach, tool_kind,
  tool_target, pack_id, flow_id, report_paths, cde_project_key, cde_snapshot_id,
  priority, suite_id, trigger_source, runner_tags, gate_status, created_at, updated_at`;

const RUN_EVENT_COLUMNS = `
  r.id, r.project_id, r.environment_id, r.test_file_id, r.test_file_path,
  req.browser_projects, req.headed, req.workers, req.retries, req.max_failures, req.trace, req.reporter,
  req.timeout_seconds, r.status, r.runner_id, r.command, left(lg.logs, 4000) AS logs,
  res.report, r.total_tests, r.passed_tests, r.failed_tests, r.skipped_tests,
  r.requested_by, r.requested_at, r.started_at, r.completed_at, r.duration_ms,
  r.last_heartbeat_at, r.source_approach, r.tool_kind, r.tool_target, r.pack_id, r.flow_id,
  r.report_paths, r.cde_project_key, r.cde_snapshot_id, src.cde_manifest,
  r.priority, r.suite_id, r.trigger_source, r.gate_status,
  scm.commit_sha, scm.git_ref, scm.pr_number, res.gate_summary`;

const RUN_CLAIM_COLUMNS = `
  r.id, r.project_id, r.environment_id, r.test_file_id, r.test_file_path,
  src.source_snapshot, req.browser_projects, req.headed, req.workers, req.retries, req.max_failures,
  req.trace, req.reporter, req.timeout_seconds, r.status, r.source_approach, r.tool_kind,
  r.tool_target, r.pack_id, r.flow_id, r.report_paths, r.cde_project_key, r.cde_snapshot_id,
  src.cde_manifest, r.requested_by, r.priority, req.tool_options,
  e.base_url, e.api_base_url, e.gateway_base_url, e.secret_references, p.name AS project_name`;

function asJson(value, fallback = {}) {
  if (value == null) return JSON.stringify(fallback);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

async function ensureRunChildren(db, runId, {
  request = {},
  source = {},
  logs = null,
  results = {},
  scm = null,
} = {}) {
  await db.query(
    `INSERT INTO run_requests (
        run_id, browser_projects, headed, workers, retries, max_failures, trace, reporter, timeout_seconds, tool_options
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET
       browser_projects=excluded.browser_projects, headed=excluded.headed, workers=excluded.workers,
       retries=excluded.retries, max_failures=excluded.max_failures, trace=excluded.trace,
       reporter=excluded.reporter, timeout_seconds=excluded.timeout_seconds, tool_options=excluded.tool_options`,
    [
      runId,
      Array.isArray(request.browser_projects) && request.browser_projects.length ? request.browser_projects : ['chromium'],
      Boolean(request.headed),
      Number(request.workers || 1),
      Number(request.retries || 0),
      request.max_failures == null ? null : Number(request.max_failures),
      request.trace || 'retain-on-failure',
      request.reporter || 'json',
      Number(request.timeout_seconds || 120),
      asJson(request.tool_options, {}),
    ],
  );
  await db.query(
    `INSERT INTO run_sources (run_id, source_snapshot, cde_manifest)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET
       source_snapshot=excluded.source_snapshot, cde_manifest=excluded.cde_manifest`,
    [runId, source.source_snapshot == null ? '' : String(source.source_snapshot), source.cde_manifest == null ? null : asJson(source.cde_manifest)],
  );
  await db.query(
    `INSERT INTO run_logs (run_id, logs, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (run_id) DO UPDATE SET logs=excluded.logs, updated_at=now()`,
    [runId, logs],
  );
  await db.query(
    `INSERT INTO run_results (run_id, report, gate_summary) VALUES ($1,$2::jsonb,$3::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET
       report=coalesce(excluded.report, run_results.report),
       gate_summary=coalesce(excluded.gate_summary, run_results.gate_summary)`,
    [
      runId,
      results.report == null ? null : asJson(results.report),
      results.gate_summary == null ? null : asJson(results.gate_summary),
    ],
  );
  if (scm && (scm.commit_sha || scm.git_ref || scm.pr_number != null)) {
    await db.query(
      `INSERT INTO run_scm (run_id, commit_sha, git_ref, pr_number) VALUES ($1,$2,$3,$4)
       ON CONFLICT (run_id) DO UPDATE SET
         commit_sha=excluded.commit_sha, git_ref=excluded.git_ref, pr_number=excluded.pr_number`,
      [runId, scm.commit_sha || null, scm.git_ref || null, scm.pr_number == null ? null : Number(scm.pr_number)],
    );
  }
}

/**
 * Insert slim run row + child payloads.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ core: object, request?: object, source?: object, logs?: string|null, scm?: object|null }} parts
 */
async function insertRun(db, parts) {
  const core = parts.core || {};
  const result = await db.query(
    `INSERT INTO runs (
        project_id, environment_id, test_file_id, test_file_path, requested_by, status,
        source_approach, tool_kind, tool_target, pack_id, flow_id, report_paths,
        cde_project_key, cde_snapshot_id, priority, suite_id, trigger_source, runner_tags,
        command
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19
     ) RETURNING ${RUN_CORE_RETURNING}`,
    [
      core.project_id,
      core.environment_id,
      core.test_file_id || null,
      core.test_file_path || '',
      core.requested_by,
      core.status || 'QUEUED',
      core.source_approach || 'CDE',
      core.tool_kind || 'PLAYWRIGHT',
      core.tool_target || null,
      core.pack_id || null,
      core.flow_id || null,
      asJson(core.report_paths, {}),
      core.cde_project_key || null,
      core.cde_snapshot_id || null,
      Number(core.priority || 0),
      core.suite_id || null,
      core.trigger_source || 'manual',
      Array.isArray(core.runner_tags) ? core.runner_tags : [],
      core.command || null,
    ],
  );
  const row = result.rows[0];
  await ensureRunChildren(db, row.id, {
    request: parts.request,
    source: parts.source,
    logs: parts.logs == null ? null : String(parts.logs),
    scm: parts.scm || null,
  });
  return row;
}

async function setRunLogs(db, runId, logs, { touchHeartbeat = true } = {}) {
  await db.query(
    `INSERT INTO run_logs (run_id, logs, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (run_id) DO UPDATE SET logs=excluded.logs, updated_at=now()`,
    [runId, logs],
  );
  if (touchHeartbeat) {
    await db.query('UPDATE runs SET last_heartbeat_at=now(), updated_at=now() WHERE id=$1', [runId]);
  } else {
    await db.query('UPDATE runs SET updated_at=now() WHERE id=$1', [runId]);
  }
}

async function appendRunLogs(db, runId, suffix) {
  await db.query(
    `INSERT INTO run_logs (run_id, logs, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (run_id) DO UPDATE SET logs = coalesce(run_logs.logs,'') || excluded.logs, updated_at=now()`,
    [runId, suffix],
  );
  await db.query('UPDATE runs SET updated_at=now() WHERE id=$1', [runId]);
}

async function setRunSourceManifest(db, runId, cdeManifest) {
  await db.query(
    `INSERT INTO run_sources (run_id, source_snapshot, cde_manifest) VALUES ($1,'',$2::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET cde_manifest=excluded.cde_manifest`,
    [runId, asJson(cdeManifest)],
  );
}

async function completeRun(db, runId, {
  status,
  logs,
  report,
  totalTests,
  passedTests,
  failedTests,
  skippedTests,
  durationMs,
  reportPaths,
}) {
  await db.query(
    `UPDATE runs SET
        status=$1, total_tests=$2, passed_tests=$3, failed_tests=$4, skipped_tests=$5,
        completed_at=now(), duration_ms=$6, last_heartbeat_at=now(), updated_at=now(),
        report_paths=coalesce($7::jsonb, report_paths)
     WHERE id=$8`,
    [
      status,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      durationMs,
      reportPaths == null ? null : asJson(reportPaths),
      runId,
    ],
  );
  await setRunLogs(db, runId, logs, { touchHeartbeat: false });
  await db.query(
    `INSERT INTO run_results (run_id, report) VALUES ($1,$2::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET report=excluded.report`,
    [runId, report == null ? null : asJson(report)],
  );
}

async function setGateOutcome(db, runId, gateStatus, gateSummary) {
  await db.query('UPDATE runs SET gate_status=$2, updated_at=now() WHERE id=$1', [runId, gateStatus]);
  await db.query(
    `INSERT INTO run_results (run_id, gate_summary) VALUES ($1,$2::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET gate_summary=excluded.gate_summary`,
    [runId, gateSummary == null ? null : asJson(gateSummary)],
  );
}

async function getRunLogs(db, runId) {
  const result = await db.query('SELECT logs FROM run_logs WHERE run_id=$1', [runId]);
  return result.rows[0]?.logs || '';
}

module.exports = {
  RUN_CHILD_JOINS,
  RUN_CORE_RETURNING,
  RUN_EVENT_COLUMNS,
  RUN_CLAIM_COLUMNS,
  insertRun,
  ensureRunChildren,
  setRunLogs,
  appendRunLogs,
  setRunSourceManifest,
  completeRun,
  setGateOutcome,
  getRunLogs,
};

const { EventEmitter } = require('node:events');
const { excerptLogs } = require('../../../../shared/log-excerpt.cjs');

const RUN_EVENT_COLUMNS = `
  r.id, r.project_id, r.environment_id, r.test_file_id, r.test_file_path,
  r.browser_projects, r.headed, r.workers, r.retries, r.max_failures, r.trace, r.reporter,
  r.timeout_seconds, r.status, r.runner_id, r.command, left(r.logs, 4000) AS logs,
  r.report, r.total_tests, r.passed_tests, r.failed_tests, r.skipped_tests,
  r.requested_by, r.requested_at, r.started_at, r.completed_at, r.duration_ms,
  r.last_heartbeat_at, r.source_approach, r.tool_kind, r.tool_target, r.pack_id, r.flow_id,
  r.report_paths, r.cde_project_key, r.cde_snapshot_id, r.cde_manifest
`;

const RUN_SNAPSHOT_JSON = `(SELECT json_build_object('id',s.id,'status',s.status,'contentHash',s.content_hash,'fileCount',s.file_count,'errorCode',s.error_code,'errorMessage',s.error_message,'expiresAt',s.expires_at,'manifest',s.manifest) FROM cde_source_snapshots s WHERE s.id=r.cde_snapshot_id) AS cde_snapshot`;
const RUN_SNAPSHOT_LIST_JSON = `(SELECT json_build_object('id',s.id,'status',s.status,'fileCount',s.file_count,'errorCode',s.error_code) FROM cde_source_snapshots s WHERE s.id=r.cde_snapshot_id) AS cde_snapshot`;
const RUN_ARTIFACTS_JSON = `coalesce((SELECT json_agg(json_build_object('id',a.id,'kind',a.kind,'fileName',a.file_name,'mimeType',a.mime_type,'sizeBytes',a.size_bytes)) FROM artifacts a WHERE a.run_id=r.id), '[]') AS artifacts`;

const RUN_CLAIM_COLUMNS = `
  r.id, r.project_id, r.environment_id, r.test_file_id, r.test_file_path,
  r.source_snapshot, r.browser_projects, r.headed, r.workers, r.retries, r.max_failures,
  r.trace, r.reporter, r.timeout_seconds, r.status, r.source_approach, r.tool_kind,
  r.tool_target, r.pack_id, r.flow_id, r.report_paths, r.cde_project_key, r.cde_snapshot_id,
  r.cde_manifest, r.requested_by,
  e.base_url, e.api_base_url, e.gateway_base_url, e.secret_references, p.name AS project_name
`;

function startRunEventBus(pool) {
  const bus = new EventEmitter();
  bus.setMaxListeners(200);
  if (process.env.SKIP_RUN_EVENT_BUS === '1') return bus;
  (async () => {
    const client = await pool.connect();
    await client.query('LISTEN run_events');
    client.on('notification', message => {
      if (message.channel === 'run_events' && message.payload) bus.emit('update', message.payload);
    });
    client.on('error', error => console.error(JSON.stringify({ event: 'run-listen-error', message: error.message })));
  })().catch(error => console.error(JSON.stringify({ event: 'run-listen-start-failed', message: error.message })));
  return bus;
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function attachRunSse(req, res, { runId, loadRun }) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  let closed = false;
  const send = payload => {
    if (!closed) writeSse(res, payload);
  };
  loadRun().then(send).catch(() => undefined);
  const onUpdate = payload => {
    if (closed || String(payload) !== String(runId)) return;
    loadRun().then(send).catch(() => undefined);
  };
  req.app.locals.runBus.on('update', onUpdate);
  const ping = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15_000);
  req.on('close', () => {
    closed = true;
    clearInterval(ping);
    req.app.locals.runBus.off('update', onUpdate);
  });
}

module.exports = {
  RUN_EVENT_COLUMNS, RUN_SNAPSHOT_JSON, RUN_SNAPSHOT_LIST_JSON, RUN_ARTIFACTS_JSON, RUN_CLAIM_COLUMNS,
  startRunEventBus, writeSse, attachRunSse, excerptLogs,
};

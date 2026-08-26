const { EventEmitter } = require('node:events');
const { excerptLogs } = require('../../../../shared/log-excerpt.cjs');
const {
  RUN_EVENT_COLUMNS, RUN_CLAIM_COLUMNS, RUN_CHILD_JOINS,
} = require('../../../../shared/db/run-store.cjs');

const RUN_SNAPSHOT_JSON = `(SELECT json_build_object('id',s.id,'status',s.status,'contentHash',s.content_hash,'fileCount',s.file_count,'errorCode',s.error_code,'errorMessage',s.error_message,'expiresAt',s.expires_at,'manifest',s.manifest) FROM cde_source_snapshots s WHERE s.id=r.cde_snapshot_id) AS cde_snapshot`;
const RUN_SNAPSHOT_LIST_JSON = `(SELECT json_build_object('id',s.id,'status',s.status,'fileCount',s.file_count,'errorCode',s.error_code) FROM cde_source_snapshots s WHERE s.id=r.cde_snapshot_id) AS cde_snapshot`;
const RUN_ARTIFACTS_JSON = `coalesce((SELECT json_agg(json_build_object('id',a.id,'kind',a.kind,'fileName',a.file_name,'mimeType',a.mime_type,'sizeBytes',a.size_bytes)) FROM artifacts a WHERE a.run_id=r.id), '[]') AS artifacts`;

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
  RUN_EVENT_COLUMNS,
  RUN_SNAPSHOT_JSON,
  RUN_SNAPSHOT_LIST_JSON,
  RUN_ARTIFACTS_JSON,
  RUN_CLAIM_COLUMNS,
  RUN_CHILD_JOINS,
  startRunEventBus,
  writeSse,
  attachRunSse,
  excerptLogs,
};

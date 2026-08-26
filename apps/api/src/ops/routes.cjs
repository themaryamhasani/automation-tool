const { asyncRoute, camelRow } = require('../http.cjs');
const { collectHealthDetail } = require('../health/routes.cjs');

const OPS_INTERVAL_MS = Math.max(2000, Number(process.env.OPS_DASHBOARD_INTERVAL_MS || 5000));

async function collectOpsSnapshot(pool, retentionWorker) {
  const [health, runners, cde, sources, recent] = await Promise.all([
    collectHealthDetail(pool, retentionWorker),
    pool.query(
      `SELECT runner_id, hostname, tags, concurrency, active_runs, last_seen_at, metadata
         FROM runner_instances
        WHERE last_seen_at > now() - interval '5 minutes'
        ORDER BY last_seen_at DESC
        LIMIT 50`,
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE expires_at > now())::int AS active_sessions,
              count(*) FILTER (WHERE expires_at <= now())::int AS expired_sessions
         FROM cde_sessions`,
    ),
    pool.query(
      `SELECT provider, count(*)::int AS total
         FROM user_source_connections
        WHERE expires_at > now()
        GROUP BY provider`,
    ),
    pool.query(
      `SELECT r.id, r.status, r.tool_kind, r.priority, r.runner_id, scm.commit_sha, r.gate_status,
              r.requested_at, r.started_at, p.name AS project_name
         FROM runs r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN run_scm scm ON scm.run_id = r.id
        WHERE r.status IN ('PREPARING','QUEUED','RUNNING','CANCEL_REQUESTED')
           OR r.completed_at > now() - interval '30 minutes'
        ORDER BY coalesce(r.started_at, r.requested_at) DESC
        LIMIT 30`,
    ),
  ]);

  return {
    ...health,
    fleet: {
      online: runners.rowCount,
      runners: runners.rows.map(camelRow),
    },
    cdeConnectivity: {
      activeSessions: cde.rows[0]?.active_sessions || 0,
      expiredSessions: cde.rows[0]?.expired_sessions || 0,
    },
    sourceConnections: Object.fromEntries(sources.rows.map(row => [row.provider, row.total])),
    recentRuns: recent.rows.map(camelRow),
  };
}

function attachOpsSse(req, res, { loadSnapshot }) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  let closed = false;
  const send = async () => {
    if (closed) return;
    try {
      const snapshot = await loadSnapshot();
      res.write(`event: ops\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`);
    }
  };
  send();
  const timer = setInterval(send, OPS_INTERVAL_MS);
  const ping = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15000);
  req.on('close', () => {
    closed = true;
    clearInterval(timer);
    clearInterval(ping);
  });
}

function registerOpsRoutes(app, { pool, retentionWorker }) {
  app.get('/api/ops/snapshot', asyncRoute(async (_req, res) => {
    res.json(await collectOpsSnapshot(pool, retentionWorker));
  }));

  app.get('/api/ops/events', asyncRoute(async (req, res) => {
    attachOpsSse(req, res, {
      loadSnapshot: () => collectOpsSnapshot(pool, retentionWorker),
    });
    await new Promise(resolve => req.on('close', resolve));
  }));
}

module.exports = { registerOpsRoutes, collectOpsSnapshot, OPS_INTERVAL_MS };

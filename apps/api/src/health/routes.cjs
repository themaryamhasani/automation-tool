const { asyncRoute } = require('../http.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { artifactRoot, dirSizeBytes, ARTIFACT_RETENTION_DAYS } = require('../retention/worker.cjs');

async function collectHealthDetail(pool, retentionWorker) {
  const [
    db,
    queue,
    snapshots,
    runtimeSessions,
    runner,
    staleRuns,
  ] = await Promise.all([
    pool.query('SELECT 1 AS ok'),
    pool.query(
      `SELECT status, count(*)::int AS total FROM runs
        WHERE status IN ('PREPARING','QUEUED','RUNNING','CANCEL_REQUESTED')
        GROUP BY status`,
    ),
    pool.query(
      `SELECT status, count(*)::int AS total FROM cde_source_snapshots
        WHERE purged_at IS NULL AND status IN ('PENDING','MATERIALIZING','READY')
        GROUP BY status`,
    ),
    pool.query('SELECT count(*)::int AS total FROM runtime_sessions WHERE expires_at > now()'),
    pool.query('SELECT enabled, default_timeout_seconds, default_workers FROM runner_settings WHERE id=1'),
    pool.query(
      `SELECT count(*)::int AS total FROM runs
        WHERE status='RUNNING' AND last_heartbeat_at < now() - interval '3 minutes'`,
    ),
  ]);

  const queueMap = Object.fromEntries(queue.rows.map(row => [row.status, row.total]));
  const snapshotMap = Object.fromEntries(snapshots.rows.map(row => [row.status, row.total]));
  const diskBytes = await dirSizeBytes(artifactRoot()).catch(() => 0);

  return {
    status: 'ok',
    service: 'automation-api',
    time: new Date().toISOString(),
    database: Boolean(db.rowCount),
    queue: {
      preparing: queueMap.PREPARING || 0,
      queued: queueMap.QUEUED || 0,
      running: queueMap.RUNNING || 0,
      cancelRequested: queueMap.CANCEL_REQUESTED || 0,
    },
    snapshots: {
      pending: snapshotMap.PENDING || 0,
      materializing: snapshotMap.MATERIALIZING || 0,
      ready: snapshotMap.READY || 0,
    },
    runtimeSessions: { active: runtimeSessions.rows[0]?.total || 0 },
    runner: {
      enabled: Boolean(runner.rows[0]?.enabled),
      defaultTimeoutSeconds: runner.rows[0]?.default_timeout_seconds || null,
      defaultWorkers: runner.rows[0]?.default_workers || null,
      staleRunning: staleRuns.rows[0]?.total || 0,
    },
    artifacts: {
      root: artifactRoot(),
      diskBytes,
      retentionDays: ARTIFACT_RETENTION_DAYS,
    },
    retention: retentionWorker?.lastSummary?.() || null,
  };
}

function registerHealthRoutes(app, { pool, retentionWorker }) {
  app.get('/api/health', asyncRoute(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'automation-api', time: new Date().toISOString() });
  }));

  app.get('/api/health/detail', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
    res.json(await collectHealthDetail(pool, retentionWorker));
  }));
}

module.exports = { registerHealthRoutes, collectHealthDetail };

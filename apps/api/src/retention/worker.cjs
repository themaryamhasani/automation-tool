const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const ARTIFACT_RETENTION_DAYS = Math.max(1, Number(process.env.ARTIFACT_RETENTION_DAYS || 30));
const RETENTION_INTERVAL_MS = Math.max(60_000, Number(process.env.RETENTION_INTERVAL_MS || 3_600_000));

function artifactRoot() {
  return path.resolve(process.cwd(), process.env.ARTIFACT_ROOT || 'artifacts/playwright');
}

async function dirSizeBytes(root) {
  if (!fsSync.existsSync(root)) return 0;
  let total = 0;
  const walk = async dir => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else {
        const stat = await fs.stat(target);
        total += stat.size;
      }
    }
  };
  await walk(root);
  return total;
}

async function runRetention(pool) {
  const started = Date.now();
  const summary = {
    runtimeSessions: 0,
    snapshots: 0,
    artifacts: 0,
    artifactBytes: 0,
    durationMs: 0,
  };

  const runtime = await pool.query('DELETE FROM runtime_sessions WHERE expires_at < now()');
  summary.runtimeSessions = runtime.rowCount || 0;

  const snapshots = await pool.query(
    `UPDATE cde_source_snapshots s
        SET status='PURGED', purged_at=now(), updated_at=now()
      WHERE s.purged_at IS NULL
        AND s.expires_at < now()
        AND s.status IN ('READY', 'FAILED')
        AND NOT EXISTS (
          SELECT 1 FROM runs r
           WHERE r.cde_snapshot_id = s.id
             AND r.status IN ('PREPARING', 'QUEUED', 'RUNNING')
        )
      RETURNING s.id`,
  );
  summary.snapshots = snapshots.rowCount || 0;

  const cutoff = await pool.query(
    `SELECT r.id FROM runs r
      WHERE r.completed_at IS NOT NULL
        AND r.completed_at < now() - ($1 || ' days')::interval
        AND r.status IN ('PASSED', 'FAILED', 'ERROR', 'CANCELLED')`,
    [ARTIFACT_RETENTION_DAYS],
  );

  const root = artifactRoot();
  for (const row of cutoff.rows) {
    const target = path.resolve(root, String(row.id));
    if (target.startsWith(`${root}${path.sep}`) && fsSync.existsSync(target)) {
      try {
        const size = await dirSizeBytes(target);
        await fs.rm(target, { recursive: true, force: true });
        summary.artifacts += 1;
        summary.artifactBytes += size;
      } catch { /* skip locked dirs */ }
    }
  }

  summary.durationMs = Date.now() - started;
  return summary;
}

function startRetentionWorker(pool) {
  let lastSummary = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      lastSummary = await runRetention(pool);
      console.log(JSON.stringify({ event: 'retention-complete', ...lastSummary }));
    } catch (error) {
      console.error(JSON.stringify({ event: 'retention-error', message: error.message }));
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), RETENTION_INTERVAL_MS);
  timer.unref();
  return {
    stop() { clearInterval(timer); },
    lastSummary: () => lastSummary,
    runNow: () => tick(),
  };
}

module.exports = {
  ARTIFACT_RETENTION_DAYS,
  RETENTION_INTERVAL_MS,
  artifactRoot,
  dirSizeBytes,
  runRetention,
  startRetentionWorker,
};

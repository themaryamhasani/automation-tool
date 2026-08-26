const { nextCronRun } = require('../../../../shared/cron-next.cjs');
const { triggerSuite } = require('./suite-runner.cjs');

const SCHEDULER_INTERVAL_MS = Math.max(15_000, Number(process.env.SCHEDULER_INTERVAL_MS || 60_000));

async function tickScheduler(pool, { trigger = triggerSuite } = {}) {
  const due = await pool.query(
    `SELECT id, project_id, environment_id, schedule_cron, schedule_timezone, priority, runner_tags, items, created_by
       FROM test_suites
      WHERE enabled = true
        AND schedule_cron IS NOT NULL
        AND (next_run_at IS NULL OR next_run_at <= now())
      ORDER BY next_run_at NULLS FIRST, created_at
      LIMIT 20`,
  );
  let triggered = 0;
  for (const suite of due.rows) {
    try {
      await trigger(pool, suite, { triggerSource: 'schedule' });
      triggered += 1;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'suite-schedule-failed',
        suiteId: suite.id,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
    const next = nextCronRun(suite.schedule_cron, suite.schedule_timezone || 'Asia/Tehran');
    await pool.query('UPDATE test_suites SET next_run_at = $2, updated_at = now() WHERE id = $1', [suite.id, next]);
  }
  return { due: due.rowCount, triggered };
}

function startScheduler(pool) {
  let timer;
  const run = async () => {
    try {
      const summary = await tickScheduler(pool);
      if (summary.triggered) {
        console.log(JSON.stringify({ event: 'scheduler-tick', ...summary }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'scheduler-error',
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  run();
  timer = setInterval(run, SCHEDULER_INTERVAL_MS);
  timer.unref();
  return {
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

module.exports = { startScheduler, tickScheduler, SCHEDULER_INTERVAL_MS };

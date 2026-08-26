const { camelRow } = require('../http.cjs');
const { createApproachRun } = require('../runs/create-run.cjs');

async function loadSuiteActor(pool, suite) {
  const result = await pool.query(
    `SELECT id, full_name, email, phone_number, role FROM users WHERE id = $1 AND is_active = true`,
    [suite.created_by],
  );
  if (!result.rowCount) throw new Error('Suite owner is not available.');
  return { ...camelRow(result.rows[0]), sessionId: null };
}

async function triggerSuite(pool, suite, { triggerSource = 'manual' } = {}) {
  const project = await pool.query('SELECT id, name, code, source_approach FROM projects WHERE id = $1', [suite.project_id]);
  if (!project.rowCount) throw new Error('Suite project not found.');
  const items = Array.isArray(suite.items) ? suite.items : JSON.parse(suite.items || '[]');
  if (!items.length) return [];

  const actor = await loadSuiteActor(pool, suite);
  const runs = [];
  for (const item of items) {
    const body = {
      ...item,
      projectId: suite.project_id,
      environmentId: suite.environment_id || item.environmentId,
      priority: Number(suite.priority ?? item.priority ?? 0),
      suiteId: suite.id,
      triggerSource,
      runnerTags: suite.runner_tags || item.runnerTags || [],
    };
    const created = await createApproachRun(pool, actor, camelRow(project.rows[0]), body);
    runs.push(created);
  }
  await pool.query('UPDATE test_suites SET last_run_at = now(), updated_at = now() WHERE id = $1', [suite.id]);
  return runs;
}

module.exports = { triggerSuite, loadSuiteActor };

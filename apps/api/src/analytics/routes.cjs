const { ApiError, asyncRoute, camelRow, cleanText, pagination, paged } = require('../http.cjs');
const { refreshFlakyStats } = require('../../../../shared/flaky-stats.cjs');
const { buildRunDelta, detailsFromReport } = require('../../../../shared/run-delta.cjs');

const RUN_COMPARE_COLUMNS = `
  r.id, r.project_id, r.status, r.tool_kind, r.pack_id, r.flow_id, r.test_file_path,
  r.total_tests, r.passed_tests, r.failed_tests, r.skipped_tests, r.duration_ms,
  r.requested_at, r.started_at, r.completed_at, r.trigger_source, r.priority,
  p.name AS project_name, u.full_name AS requested_by_name
`;

function registerAnalyticsRoutes(app, { pool, ensureProjectAccess }) {
  app.get('/api/analytics/flaky', asyncRoute(async (req, res) => {
    const projectId = cleanText(req.query.projectId, 100);
    if (projectId) await ensureProjectAccess(req.user, projectId);
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const clauses = ['s.fail_rate > 0'];
    if (req.user.role !== 'ADMIN') {
      values.push(req.user.id);
      clauses.push(`EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id = s.project_id AND up.user_id = $${values.length})`);
    }
    if (projectId) {
      values.push(projectId);
      clauses.push(`s.project_id = $${values.length}`);
    } else {
      clauses.push(`EXISTS (SELECT 1 FROM projects px WHERE px.id = s.project_id AND px.kind = 'NAMED')`);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const count = await pool.query(
      `SELECT count(*)::int AS total FROM flaky_test_stats s ${where}`,
      values,
    );
    const result = await pool.query(
      `SELECT s.id, s.project_id, p.name AS project_name, s.test_key, s.test_file_path, s.tool_kind, s.pack_id, s.flow_id,
              s.pass_count, s.fail_count, s.total_runs, s.fail_rate, s.last_status, s.last_run_id, s.last_seen_at, s.updated_at
         FROM flaky_test_stats s
         JOIN projects p ON p.id = s.project_id
         ${where}
        ORDER BY s.fail_rate DESC, s.fail_count DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    res.json(paged(result.rows.map(camelRow), count.rows[0].total, page, limit));
  }));

  app.post('/api/analytics/flaky/refresh', asyncRoute(async (req, res) => {
    const projectId = cleanText(req.body?.projectId, 100);
    if (projectId) await ensureProjectAccess(req.user, projectId, true);
    else if (req.user.role !== 'ADMIN') throw new ApiError(403, 'ACCESS_DENIED', 'فقط مدیر می‌تواند همه پروژه‌ها را بازمحاسبه کند.');
    await refreshFlakyStats(pool, projectId || null);
    res.json({ ok: true });
  }));

  app.get('/api/analytics/runs/compare', asyncRoute(async (req, res) => {
    const leftId = cleanText(req.query.leftId, 100);
    const rightId = cleanText(req.query.rightId, 100);
    if (!leftId || !rightId) throw new ApiError(422, 'COMPARE_IDS_REQUIRED', 'دو شناسه اجرا برای مقایسه لازم است.');
    const result = await pool.query(
      `SELECT ${RUN_COMPARE_COLUMNS}
         FROM runs r
         JOIN projects p ON p.id = r.project_id
         JOIN users u ON u.id = r.requested_by
        WHERE r.id = ANY($1::uuid[])`,
      [[leftId, rightId]],
    );
    if (result.rowCount < 2) throw new ApiError(404, 'RUN_NOT_FOUND', 'یکی از اجراها پیدا نشد.');
    for (const row of result.rows) await ensureProjectAccess(req.user, row.project_id);
    const left = camelRow(result.rows.find(row => row.id === leftId) || result.rows[0]);
    const right = camelRow(result.rows.find(row => row.id === rightId) || result.rows[1]);

    const leftDetails = await pool.query('SELECT report FROM runs WHERE id = $1', [leftId]);
    const rightDetails = await pool.query('SELECT report FROM runs WHERE id = $1', [rightId]);
    const delta = buildRunDelta(
      detailsFromReport(leftDetails.rows[0]?.report),
      detailsFromReport(rightDetails.rows[0]?.report),
    );
    res.json({
      left,
      right,
      summary: {
        durationDeltaMs: (right.durationMs || 0) - (left.durationMs || 0),
        failedDelta: (right.failedTests || 0) - (left.failedTests || 0),
        passedDelta: (right.passedTests || 0) - (left.passedTests || 0),
        changedTests: delta.summary.changedTests,
        newFail: delta.summary.newFail,
        stillFail: delta.summary.stillFail,
        fixed: delta.summary.fixed,
        regressionCount: delta.summary.regressionCount,
        openFailCount: delta.summary.openFailCount,
      },
      diffs: delta.items.slice(0, 200).map(item => ({
        title: item.title,
        change: item.change,
        leftOutcome: item.leftOutcome,
        rightOutcome: item.rightOutcome,
        leftError: item.leftError,
        rightError: item.rightError,
        path: item.path,
        hint: item.hint,
      })),
    });
  }));
}

module.exports = { registerAnalyticsRoutes, refreshFlakyStats };

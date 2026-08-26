const { ApiError, asyncRoute, camelRow, cleanText } = require('../../http.cjs');
const { requireRole } = require('../../middleware/auth.cjs');
const { requireScope } = require('../../auth/api-token.cjs');
const { nextCronRun, isValidCron } = require('../../../../../shared/cron-next.cjs');
const { triggerSuite } = require('../suite-runner.cjs');

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(422, 'SUITE_ITEMS_REQUIRED', 'حداقل یک آیتم تست در مجموعه لازم است.');
  }
  return items.slice(0, 50).map(item => ({
    testFilePath: item.testFilePath ? String(item.testFilePath) : undefined,
    toolKind: item.toolKind ? String(item.toolKind).toUpperCase() : undefined,
    flowId: item.flowId ? String(item.flowId).toUpperCase() : undefined,
    packId: item.packId ? String(item.packId) : undefined,
    toolTarget: item.toolTarget ? String(item.toolTarget) : undefined,
    sourceApproach: item.sourceApproach ? String(item.sourceApproach).toUpperCase() : undefined,
    priority: item.priority == null ? undefined : Number(item.priority),
    runnerTags: Array.isArray(item.runnerTags) ? item.runnerTags.map(String) : undefined,
  }));
}

function registerSuiteRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/projects/:projectId/suites', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    const result = await pool.query(
      `SELECT id, project_id, name, description, environment_id, schedule_cron, schedule_timezone,
              enabled, priority, runner_tags, items, created_by, last_run_at, next_run_at, created_at, updated_at
         FROM test_suites WHERE project_id = $1 ORDER BY name`,
      [req.params.projectId],
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/projects/:projectId/suites', requireRole('ADMIN', 'OPERATOR'), requireScope('suites:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const name = cleanText(req.body?.name, 120);
    if (!name) throw new ApiError(422, 'SUITE_NAME_REQUIRED', 'نام مجموعه تست الزامی است.');
    const scheduleCron = cleanText(req.body?.scheduleCron, 120) || null;
    const scheduleTimezone = cleanText(req.body?.scheduleTimezone, 80) || 'Asia/Tehran';
    if (scheduleCron && !isValidCron(scheduleCron)) {
      throw new ApiError(422, 'INVALID_CRON', 'عبارت cron زمان‌بندی معتبر نیست.');
    }
    const items = normalizeItems(req.body?.items);
    const nextRunAt = scheduleCron ? nextCronRun(scheduleCron, scheduleTimezone) : null;
    const result = await pool.query(
      `INSERT INTO test_suites (
          project_id, name, description, environment_id, schedule_cron, schedule_timezone,
          enabled, priority, runner_tags, items, created_by, next_run_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
       RETURNING *`,
      [
        req.params.projectId,
        name,
        cleanText(req.body?.description, 2000) || null,
        req.body?.environmentId || null,
        scheduleCron,
        scheduleTimezone,
        req.body?.enabled !== false,
        Number(req.body?.priority || 0),
        Array.isArray(req.body?.runnerTags) ? req.body.runnerTags.map(String).slice(0, 16) : [],
        JSON.stringify(items),
        req.user.id,
        nextRunAt,
      ],
    );
    await audit(pool, req.user.id, 'TEST_SUITE_CREATED', 'TEST_SUITE', result.rows[0].id, { projectId: req.params.projectId, name });
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/projects/:projectId/suites/:suiteId', requireRole('ADMIN', 'OPERATOR'), requireScope('suites:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const current = await pool.query(
      'SELECT * FROM test_suites WHERE id = $1 AND project_id = $2',
      [req.params.suiteId, req.params.projectId],
    );
    if (!current.rowCount) throw new ApiError(404, 'SUITE_NOT_FOUND', 'مجموعه تست پیدا نشد.');
    const scheduleCron = req.body?.scheduleCron === null
      ? null
      : cleanText(req.body?.scheduleCron, 120) || current.rows[0].schedule_cron;
    const scheduleTimezone = cleanText(req.body?.scheduleTimezone, 80) || current.rows[0].schedule_timezone;
    if (scheduleCron && !isValidCron(scheduleCron)) {
      throw new ApiError(422, 'INVALID_CRON', 'عبارت cron زمان‌بندی معتبر نیست.');
    }
    const items = req.body?.items ? normalizeItems(req.body.items) : current.rows[0].items;
    const nextRunAt = scheduleCron ? nextCronRun(scheduleCron, scheduleTimezone) : null;
    const result = await pool.query(
      `UPDATE test_suites SET
          name = COALESCE($3, name),
          description = COALESCE($4, description),
          environment_id = COALESCE($5, environment_id),
          schedule_cron = $6,
          schedule_timezone = $7,
          enabled = COALESCE($8, enabled),
          priority = COALESCE($9, priority),
          runner_tags = COALESCE($10, runner_tags),
          items = $11::jsonb,
          next_run_at = $12,
          updated_at = now()
        WHERE id = $1 AND project_id = $2
        RETURNING *`,
      [
        req.params.suiteId,
        req.params.projectId,
        cleanText(req.body?.name, 120) || null,
        req.body?.description == null ? null : cleanText(req.body.description, 2000),
        req.body?.environmentId || null,
        scheduleCron,
        scheduleTimezone,
        req.body?.enabled == null ? null : Boolean(req.body.enabled),
        req.body?.priority == null ? null : Number(req.body.priority),
        Array.isArray(req.body?.runnerTags) ? req.body.runnerTags.map(String).slice(0, 16) : null,
        JSON.stringify(items),
        nextRunAt,
      ],
    );
    await audit(pool, req.user.id, 'TEST_SUITE_UPDATED', 'TEST_SUITE', req.params.suiteId, { projectId: req.params.projectId });
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/projects/:projectId/suites/:suiteId', requireRole('ADMIN', 'OPERATOR'), requireScope('suites:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const deleted = await pool.query(
      'DELETE FROM test_suites WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.suiteId, req.params.projectId],
    );
    if (!deleted.rowCount) throw new ApiError(404, 'SUITE_NOT_FOUND', 'مجموعه تست پیدا نشد.');
    await audit(pool, req.user.id, 'TEST_SUITE_DELETED', 'TEST_SUITE', req.params.suiteId);
    res.json({ ok: true });
  }));

  app.post('/api/projects/:projectId/suites/:suiteId/run', requireRole('ADMIN', 'OPERATOR'), requireScope('suites:run', 'runs:create'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const current = await pool.query(
      'SELECT * FROM test_suites WHERE id = $1 AND project_id = $2 AND enabled = true',
      [req.params.suiteId, req.params.projectId],
    );
    if (!current.rowCount) throw new ApiError(404, 'SUITE_NOT_FOUND', 'مجموعه تست فعال پیدا نشد.');
    const runs = await triggerSuite(pool, current.rows[0], { triggerSource: 'manual' });
    await audit(pool, req.user.id, 'TEST_SUITE_TRIGGERED', 'TEST_SUITE', req.params.suiteId, { runCount: runs.length });
    res.status(201).json({ runs: runs.map(camelRow) });
  }));
}

module.exports = { registerSuiteRoutes };

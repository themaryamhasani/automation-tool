const { asyncRoute, camelRow, parsePositiveInt, pagination, paged } = require('../http.cjs');
const { audit, requireRole } = require('../middleware/auth.cjs');
const { TRACE_MODES, REPORTERS } = require('../lib/validators.cjs');

function registerSettingsRoutes(app, { pool }) {
  app.get('/api/settings/runner', asyncRoute(async (_req, res) => {
    const result = await pool.query('SELECT * FROM runner_settings WHERE id=1');
    res.json(camelRow(result.rows[0]));
  }));

  app.put('/api/settings/runner', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const trace = TRACE_MODES.has(req.body?.defaultTrace) ? req.body.defaultTrace : 'retain-on-failure';
    const reporter = REPORTERS.has(req.body?.defaultReporter) ? req.body.defaultReporter : 'json';
    const result = await pool.query(
      `UPDATE runner_settings SET enabled=$1,default_timeout_seconds=$2,default_workers=$3,default_retries=$4,default_trace=$5,default_reporter=$6,updated_by=$7,updated_at=now()
        WHERE id=1 RETURNING *`,
      [req.body?.enabled !== false, parsePositiveInt(req.body?.defaultTimeoutSeconds, 120, 5, 3600),
        parsePositiveInt(req.body?.defaultWorkers, 1, 1, 32), parsePositiveInt(req.body?.defaultRetries, 0, 0, 10), trace, reporter, req.user.id],
    );
    await audit(pool, req.user.id, 'RUNNER_SETTINGS_UPDATED', 'SETTINGS', 'runner');
    res.json(camelRow(result.rows[0]));
  }));

  app.get('/api/audit', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const count = await pool.query('SELECT count(*)::int AS total FROM audit_logs');
    const result = await pool.query(
      `SELECT a.*,u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.json(paged(result.rows.map(camelRow), count.rows[0].total, page, limit));
  }));
}

module.exports = { registerSettingsRoutes };

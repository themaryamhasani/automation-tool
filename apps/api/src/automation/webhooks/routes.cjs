const { ApiError, asyncRoute, camelRow, cleanText } = require('../../http.cjs');
const { requireRole } = require('../../middleware/auth.cjs');
const { requireScope } = require('../../auth/api-token.cjs');

const ALLOWED_EVENTS = new Set(['run.completed', 'run.passed', 'run.failed', 'run.error', 'run.cancelled']);

function normalizeEvents(events) {
  const values = Array.isArray(events) ? events : ['run.completed'];
  const filtered = [...new Set(values.map(item => String(item).trim()).filter(item => ALLOWED_EVENTS.has(item)))];
  return filtered.length ? filtered : ['run.completed'];
}

function registerWebhookRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/projects/:projectId/webhooks', requireScope('webhooks:read'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    const result = await pool.query(
      `SELECT id, project_id, name, url, events, enabled, created_at, updated_at
         FROM webhooks WHERE project_id = $1 ORDER BY name`,
      [req.params.projectId],
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/projects/:projectId/webhooks', requireRole('ADMIN', 'OPERATOR'), requireScope('webhooks:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const name = cleanText(req.body?.name, 120);
    const url = cleanText(req.body?.url, 2000);
    if (!name || !url) throw new ApiError(422, 'WEBHOOK_REQUIRED', 'نام و URL وب‌هوک الزامی است.');
    const result = await pool.query(
      `INSERT INTO webhooks (project_id, name, url, secret, events, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, project_id, name, url, events, enabled, created_at, updated_at`,
      [
        req.params.projectId,
        name,
        url,
        cleanText(req.body?.secret, 255) || null,
        normalizeEvents(req.body?.events),
        req.body?.enabled !== false,
        req.user.id,
      ],
    );
    await audit(pool, req.user.id, 'WEBHOOK_CREATED', 'WEBHOOK', result.rows[0].id, { projectId: req.params.projectId, name });
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/projects/:projectId/webhooks/:webhookId', requireRole('ADMIN', 'OPERATOR'), requireScope('webhooks:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const result = await pool.query(
      `UPDATE webhooks SET
          name = COALESCE($3, name),
          url = COALESCE($4, url),
          secret = COALESCE($5, secret),
          events = COALESCE($6, events),
          enabled = COALESCE($7, enabled),
          updated_at = now()
        WHERE id = $1 AND project_id = $2
        RETURNING id, project_id, name, url, events, enabled, created_at, updated_at`,
      [
        req.params.webhookId,
        req.params.projectId,
        cleanText(req.body?.name, 120) || null,
        cleanText(req.body?.url, 2000) || null,
        req.body?.secret === undefined ? null : cleanText(req.body.secret, 255),
        req.body?.events ? normalizeEvents(req.body.events) : null,
        req.body?.enabled == null ? null : Boolean(req.body.enabled),
      ],
    );
    if (!result.rowCount) throw new ApiError(404, 'WEBHOOK_NOT_FOUND', 'وب‌هوک پیدا نشد.');
    await audit(pool, req.user.id, 'WEBHOOK_UPDATED', 'WEBHOOK', req.params.webhookId);
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/projects/:projectId/webhooks/:webhookId', requireRole('ADMIN', 'OPERATOR'), requireScope('webhooks:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const deleted = await pool.query(
      'DELETE FROM webhooks WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.webhookId, req.params.projectId],
    );
    if (!deleted.rowCount) throw new ApiError(404, 'WEBHOOK_NOT_FOUND', 'وب‌هوک پیدا نشد.');
    await audit(pool, req.user.id, 'WEBHOOK_DELETED', 'WEBHOOK', req.params.webhookId);
    res.json({ ok: true });
  }));
}

module.exports = { registerWebhookRoutes, ALLOWED_EVENTS };

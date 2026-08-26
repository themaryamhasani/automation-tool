const { ApiError, asyncRoute, camelRow, cleanText } = require('../../http.cjs');
const { requireRole } = require('../../middleware/auth.cjs');
const { requireScope } = require('../../auth/api-token.cjs');
const { ALLOWED_EVENTS } = require('../webhooks/routes.cjs');

const CHANNEL_KINDS = new Set(['EMAIL', 'SLACK', 'TEAMS', 'WEBHOOK']);

function normalizeEvents(events) {
  const values = Array.isArray(events) ? events : ['run.failed', 'run.error'];
  const filtered = [...new Set(values.map(item => String(item).trim()).filter(item => ALLOWED_EVENTS.has(item)))];
  return filtered.length ? filtered : ['run.failed', 'run.error'];
}

function registerNotificationRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/projects/:projectId/notifications', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    const result = await pool.query(
      `SELECT id, project_id, name, kind, config, events, enabled, created_at, updated_at
         FROM notification_channels
        WHERE project_id = $1 OR project_id IS NULL
        ORDER BY project_id NULLS LAST, name`,
      [req.params.projectId],
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/projects/:projectId/notifications', requireRole('ADMIN', 'OPERATOR'), requireScope('notifications:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const name = cleanText(req.body?.name, 120);
    const kind = String(req.body?.kind || '').toUpperCase();
    if (!name || !CHANNEL_KINDS.has(kind)) {
      throw new ApiError(422, 'NOTIFICATION_INVALID', 'نام و نوع کانال اعلان معتبر الزامی است.');
    }
    const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
    const result = await pool.query(
      `INSERT INTO notification_channels (project_id, name, kind, config, events, enabled)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, project_id, name, kind, config, events, enabled, created_at, updated_at`,
      [
        req.params.projectId,
        name,
        kind,
        JSON.stringify(config),
        normalizeEvents(req.body?.events),
        req.body?.enabled !== false,
      ],
    );
    await audit(pool, req.user.id, 'NOTIFICATION_CREATED', 'NOTIFICATION', result.rows[0].id, { projectId: req.params.projectId, kind });
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/projects/:projectId/notifications/:channelId', requireRole('ADMIN', 'OPERATOR'), requireScope('notifications:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const kind = req.body?.kind ? String(req.body.kind).toUpperCase() : null;
    if (kind && !CHANNEL_KINDS.has(kind)) throw new ApiError(422, 'NOTIFICATION_INVALID', 'نوع کانال اعلان معتبر نیست.');
    const result = await pool.query(
      `UPDATE notification_channels SET
          name = COALESCE($3, name),
          kind = COALESCE($4, kind),
          config = COALESCE($5::jsonb, config),
          events = COALESCE($6, events),
          enabled = COALESCE($7, enabled),
          updated_at = now()
        WHERE id = $1 AND (project_id = $2 OR (project_id IS NULL AND $8 = true))
        RETURNING id, project_id, name, kind, config, events, enabled, created_at, updated_at`,
      [
        req.params.channelId,
        req.params.projectId,
        cleanText(req.body?.name, 120) || null,
        kind,
        req.body?.config ? JSON.stringify(req.body.config) : null,
        req.body?.events ? normalizeEvents(req.body.events) : null,
        req.body?.enabled == null ? null : Boolean(req.body.enabled),
        req.user.role === 'ADMIN',
      ],
    );
    if (!result.rowCount) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'کانال اعلان پیدا نشد.');
    await audit(pool, req.user.id, 'NOTIFICATION_UPDATED', 'NOTIFICATION', req.params.channelId);
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/projects/:projectId/notifications/:channelId', requireRole('ADMIN', 'OPERATOR'), requireScope('notifications:write'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const deleted = await pool.query(
      `DELETE FROM notification_channels
        WHERE id = $1 AND (project_id = $2 OR (project_id IS NULL AND $3 = true))
        RETURNING id`,
      [req.params.channelId, req.params.projectId, req.user.role === 'ADMIN'],
    );
    if (!deleted.rowCount) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'کانال اعلان پیدا نشد.');
    await audit(pool, req.user.id, 'NOTIFICATION_DELETED', 'NOTIFICATION', req.params.channelId);
    res.json({ ok: true });
  }));
}

module.exports = { registerNotificationRoutes, CHANNEL_KINDS };

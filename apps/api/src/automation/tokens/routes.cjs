const { ApiError, asyncRoute, camelRow, cleanText } = require('../../http.cjs');
const { requireRole } = require('../../middleware/auth.cjs');
const {
  createApiTokenValue, normalizeScopes, tokenHash, ALLOWED_SCOPES, requireSession,
} = require('../../auth/api-token.cjs');

function registerTokenRoutes(app, { pool, audit }) {
  app.get('/api/tokens', requireSession, requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT id, name, token_prefix, scopes, project_ids, expires_at, last_used_at, revoked_at, created_at
         FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/tokens', requireSession, requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    const name = cleanText(req.body?.name, 120);
    if (!name) throw new ApiError(422, 'TOKEN_NAME_REQUIRED', 'نام توکن الزامی است.');
    const scopes = normalizeScopes(req.body?.scopes);
    const projectIds = Array.isArray(req.body?.projectIds)
      ? req.body.projectIds.map(item => String(item)).filter(Boolean).slice(0, 50)
      : null;
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new ApiError(422, 'TOKEN_EXPIRES_INVALID', 'تاریخ انقضای توکن معتبر نیست.');
    }
    const token = createApiTokenValue();
    const result = await pool.query(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, scopes, project_ids, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, token_prefix, scopes, project_ids, expires_at, created_at`,
      [req.user.id, name, tokenHash(token), token.slice(0, 12), scopes, projectIds, expiresAt],
    );
    await audit(pool, req.user.id, 'API_TOKEN_CREATED', 'API_TOKEN', result.rows[0].id, { name, scopes });
    res.status(201).json({ ...camelRow(result.rows[0]), token });
  }));

  app.delete('/api/tokens/:id', requireSession, requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    const updated = await pool.query(
      `UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!updated.rowCount) throw new ApiError(404, 'TOKEN_NOT_FOUND', 'توکن پیدا نشد.');
    await audit(pool, req.user.id, 'API_TOKEN_REVOKED', 'API_TOKEN', req.params.id);
    res.json({ ok: true });
  }));

  app.get('/api/tokens/scopes', requireSession, requireRole('ADMIN', 'OPERATOR'), (_req, res) => {
    res.json([...ALLOWED_SCOPES]);
  });
}

module.exports = { registerTokenRoutes };

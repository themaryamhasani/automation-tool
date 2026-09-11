const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { ApiError, asyncRoute, camelRow } = require('../http.cjs');
const { clientAddress, tokenHash } = require('../middleware/auth.cjs');
const {
  requireSession,
  EXTENSION_ACCESS_TOKEN_PREFIX: ACCESS_PREFIX,
  EXTENSION_REFRESH_TOKEN_PREFIX: REFRESH_PREFIX,
  EXTENSION_SCOPES,
} = require('../auth/api-token.cjs');

const PAIRING_PREFIX = 'pair_';
const PAIRING_TTL_SECONDS = Math.min(120, Math.max(30, Number(process.env.EXTENSION_PAIRING_TTL_SECONDS || 90)));
const ACCESS_TTL_SECONDS = Math.min(3600, Math.max(300, Number(process.env.EXTENSION_ACCESS_TTL_SECONDS || 900)));
const REFRESH_TTL_DAYS = Math.min(90, Math.max(1, Number(process.env.EXTENSION_REFRESH_TTL_DAYS || 30)));

function opaqueValue(prefix) {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

function extensionCredentialValues() {
  const accessToken = opaqueValue(ACCESS_PREFIX);
  const refreshToken = opaqueValue(REFRESH_PREFIX);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

async function accessibleProjectIds(pool, user) {
  const result = user.role === 'ADMIN'
    ? await pool.query("SELECT id FROM projects WHERE is_active=true AND kind='NAMED' ORDER BY id")
    : await pool.query(
      `SELECT p.id FROM projects p
        JOIN user_projects up ON up.project_id=p.id
       WHERE up.user_id=$1 AND p.is_active=true AND p.kind='NAMED' ORDER BY p.id`,
      [user.id],
    );
  return result.rows.map(row => row.id);
}

async function insertExtensionSession(client, userId, projectIds, values, request) {
  const deviceId = typeof request.body?.deviceId === 'string' ? request.body.deviceId.slice(0, 200) : '';
  const inserted = await client.query(
    `INSERT INTO extension_sessions
       (user_id,access_token_hash,refresh_token_hash,token_prefix,project_ids,access_expires_at,refresh_expires_at,device_id_hash,user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      userId,
      tokenHash(values.accessToken),
      tokenHash(values.refreshToken),
      values.accessToken.slice(0, 12),
      projectIds,
      values.accessExpiresAt,
      values.refreshExpiresAt,
      deviceId ? tokenHash(deviceId) : null,
      request.get('user-agent') || null,
    ],
  );
  return inserted.rows[0].id;
}

function credentialResponse(sessionId, projectIds, values) {
  return {
    sessionId,
    accessToken: values.accessToken,
    accessExpiresAt: values.accessExpiresAt.toISOString(),
    refreshToken: values.refreshToken,
    refreshExpiresAt: values.refreshExpiresAt.toISOString(),
    projectIds,
  };
}

function registerPublicExtensionRoutes(app, { pool, audit }) {
  const exchangeLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/api/extension/pairings/exchange', exchangeLimiter, asyncRoute(async (req, res) => {
    const pairingCode = typeof req.body?.pairingCode === 'string' ? req.body.pairingCode.trim() : '';
    if (!pairingCode.startsWith(PAIRING_PREFIX) || pairingCode.length > 100) {
      throw new ApiError(401, 'PAIRING_INVALID', 'The recorder pairing request is invalid or expired.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pairing = await client.query(
        `UPDATE extension_pairing_codes
            SET consumed_at=now()
          WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now()
        RETURNING id,user_id,project_ids`,
        [tokenHash(pairingCode)],
      );
      if (!pairing.rowCount) throw new ApiError(401, 'PAIRING_INVALID', 'The recorder pairing request is invalid or expired.');
      const user = await client.query('SELECT id,is_active FROM users WHERE id=$1', [pairing.rows[0].user_id]);
      if (!user.rows[0]?.is_active) throw new ApiError(401, 'PAIRING_INVALID', 'The recorder pairing request is invalid or expired.');
      const values = extensionCredentialValues();
      const sessionId = await insertExtensionSession(client, pairing.rows[0].user_id, pairing.rows[0].project_ids || [], values, req);
      await audit(client, pairing.rows[0].user_id, 'EXTENSION_PAIRED', 'EXTENSION_SESSION', sessionId, {
        projectCount: (pairing.rows[0].project_ids || []).length,
        ip: clientAddress(req),
      });
      await client.query('COMMIT');
      res.status(201).json(credentialResponse(sessionId, pairing.rows[0].project_ids || [], values));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  app.post('/api/extension/auth/refresh', exchangeLimiter, asyncRoute(async (req, res) => {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
    if (!refreshToken.startsWith(REFRESH_PREFIX) || refreshToken.length > 100) {
      throw new ApiError(401, 'EXTENSION_AUTH_EXPIRED', 'The recorder connection has expired. Connect it again.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT s.id,s.user_id,s.project_ids,u.is_active
           FROM extension_sessions s JOIN users u ON u.id=s.user_id
          WHERE s.refresh_token_hash=$1 AND s.revoked_at IS NULL AND s.refresh_expires_at>now()
          FOR UPDATE`,
        [tokenHash(refreshToken)],
      );
      if (!current.rowCount || !current.rows[0].is_active) {
        throw new ApiError(401, 'EXTENSION_AUTH_EXPIRED', 'The recorder connection has expired. Connect it again.');
      }
      const values = extensionCredentialValues();
      const updated = await client.query(
        `UPDATE extension_sessions
            SET access_token_hash=$1,refresh_token_hash=$2,token_prefix=$3,
                access_expires_at=$4,refresh_expires_at=$5,rotated_at=now(),updated_at=now()
          WHERE id=$6 AND revoked_at IS NULL
        RETURNING id`,
        [tokenHash(values.accessToken), tokenHash(values.refreshToken), values.accessToken.slice(0, 12), values.accessExpiresAt, values.refreshExpiresAt, current.rows[0].id],
      );
      if (!updated.rowCount) throw new ApiError(401, 'EXTENSION_AUTH_EXPIRED', 'The recorder connection has expired. Connect it again.');
      await audit(client, current.rows[0].user_id, 'EXTENSION_AUTH_REFRESHED', 'EXTENSION_SESSION', current.rows[0].id);
      await client.query('COMMIT');
      res.json(credentialResponse(current.rows[0].id, current.rows[0].project_ids || [], values));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));
}

function registerAuthenticatedExtensionRoutes(app, { pool, audit, requireRole }) {
  const createLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  app.post('/api/extension/pairings', createLimiter, requireSession, requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    const projectIds = await accessibleProjectIds(pool, req.user);
    const pairingCode = opaqueValue(PAIRING_PREFIX);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000);
    await pool.query("DELETE FROM extension_pairing_codes WHERE expires_at < now() - interval '1 day'");
    const result = await pool.query(
      `INSERT INTO extension_pairing_codes (user_id,code_hash,project_ids,expires_at,created_ip)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.user.id, tokenHash(pairingCode), projectIds, expiresAt, clientAddress(req)],
    );
    await audit(pool, req.user.id, 'EXTENSION_PAIRING_CREATED', 'EXTENSION_PAIRING', result.rows[0].id, {
      projectCount: projectIds.length,
      expiresAt: expiresAt.toISOString(),
    });
    res.status(201).json({ pairingCode, expiresAt: expiresAt.toISOString() });
  }));

  app.get('/api/extension/sessions', requireSession, requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT id,token_prefix,project_ids,access_expires_at,refresh_expires_at,last_used_at,rotated_at,revoked_at,created_at
         FROM extension_sessions WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows.map(camelRow));
  }));

  app.delete('/api/extension/sessions/:id', requireSession, requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    const result = await pool.query(
      `UPDATE extension_sessions SET revoked_at=now(),updated_at=now()
        WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!result.rowCount) throw new ApiError(404, 'EXTENSION_SESSION_NOT_FOUND', 'Recorder connection was not found.');
    await audit(pool, req.user.id, 'EXTENSION_REVOKED', 'EXTENSION_SESSION', req.params.id);
    res.json({ ok: true });
  }));

  app.delete('/api/extension/auth/session', asyncRoute(async (req, res) => {
    if (req.authKind !== 'extension' || !req.apiToken?.id) {
      throw new ApiError(403, 'EXTENSION_AUTH_REQUIRED', 'A paired recorder session is required.');
    }
    await pool.query('UPDATE extension_sessions SET revoked_at=now(),updated_at=now() WHERE id=$1 AND revoked_at IS NULL', [req.apiToken.id]);
    await audit(pool, req.user.id, 'EXTENSION_REVOKED', 'EXTENSION_SESSION', req.apiToken.id, { source: 'extension' });
    res.status(204).end();
  }));
}

module.exports = {
  EXTENSION_SCOPES,
  PAIRING_TTL_SECONDS,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_DAYS,
  registerPublicExtensionRoutes,
  registerAuthenticatedExtensionRoutes,
};

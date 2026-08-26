const crypto = require('node:crypto');
const argon2 = require('argon2');
const { tokenFromRequest } = require('../../../../shared/session-cookie.cjs');
const { API_TOKEN_PREFIX, apiTokenFromRequest } = require('../auth/api-token.cjs');
const { ApiError, camelRow } = require('../http.cjs');

const SESSION_TTL_HOURS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 24));
const ROLES = new Set(['ADMIN', 'OPERATOR', 'VIEWER']);

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function verifyPassword(hash, password) {
  if (typeof hash !== 'string') return false;
  if (hash.startsWith('$argon2')) return argon2.verify(hash, password).catch(() => false);
  if (/^[a-f0-9]{64}$/i.test(hash)) {
    const candidate = crypto.createHash('sha256').update(password).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
  }
  return false;
}

function clientAddress(req) {
  const value = req.ip || req.socket?.remoteAddress || null;
  return value && value.startsWith('::ffff:') ? value.slice(7) : value;
}

async function audit(client, userId, action, entityType, entityId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId || null, action, entityType || null, entityId || null, JSON.stringify(metadata)],
  );
}

async function authenticateApiToken(pool, req, token) {
  if (!token.startsWith(API_TOKEN_PREFIX)) return false;
  const result = await pool.query(
    `SELECT t.id AS token_id, t.scopes, t.project_ids, u.id, u.full_name, u.email, u.phone_number, u.role, u.is_active
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [tokenHash(token)],
  );
  if (!result.rowCount || !result.rows[0].is_active) {
    throw new ApiError(401, 'INVALID_API_TOKEN', 'توکن API معتبر نیست.');
  }
  await pool.query('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1', [tokenHash(token)]);
  req.authKind = 'api_token';
  req.apiToken = {
    id: result.rows[0].token_id,
    scopes: result.rows[0].scopes || [],
    projectIds: result.rows[0].project_ids || null,
  };
  req.user = camelRow(result.rows[0]);
  req.user.apiTokenProjectIds = result.rows[0].project_ids || null;
  delete req.user.tokenId;
  return true;
}

function createAuthenticate(pool) {
  return async function authenticate(req, _res, next) {
    const sessionToken = tokenFromRequest(req);
    if (sessionToken) {
      const result = await pool.query(
        `SELECT s.id AS session_id, u.id, u.full_name, u.email, u.phone_number, u.role, u.is_active
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
        [tokenHash(sessionToken)],
      );
      if (!result.rowCount || !result.rows[0].is_active) {
        return next(new ApiError(401, 'SESSION_EXPIRED', 'نشست شما منقضی شده است.'));
      }
      req.token = sessionToken;
      req.user = camelRow(result.rows[0]);
      return next();
    }

    const apiToken = apiTokenFromRequest(req);
    if (apiToken) {
      try {
        const ok = await authenticateApiToken(pool, req, apiToken);
        if (ok) return next();
      } catch (error) {
        return next(error);
      }
    }

    return next(new ApiError(401, 'AUTH_REQUIRED', 'برای ادامه وارد سامانه شوید.'));
  };
}

function requireRole(...roles) {
  return (req, _res, next) => roles.includes(req.user.role)
    ? next()
    : next(new ApiError(403, 'ACCESS_DENIED', 'اجازه انجام این عملیات را ندارید.'));
}

async function ensureProjectAccess(pool, user, projectId, write = false) {
  if (!projectId) throw new ApiError(422, 'PROJECT_REQUIRED', 'انتخاب پروژه الزامی است.');
  if (user.apiTokenProjectIds?.length && !user.apiTokenProjectIds.includes(projectId)) {
    throw new ApiError(403, 'PROJECT_ACCESS_DENIED', 'این توکن API به این پروژه دسترسی ندارد.');
  }
  if (write && user.role === 'VIEWER') throw new ApiError(403, 'ACCESS_DENIED', 'دسترسی شما فقط خواندنی است.');
  const result = user.role === 'ADMIN'
    ? await pool.query('SELECT id FROM projects WHERE id = $1', [projectId])
    : await pool.query(
      `SELECT p.id FROM projects p JOIN user_projects up ON up.project_id = p.id
        WHERE p.id = $1 AND up.user_id = $2 AND p.is_active = true`,
      [projectId, user.id],
    );
  if (!result.rowCount) throw new ApiError(403, 'PROJECT_ACCESS_DENIED', 'به این پروژه دسترسی ندارید.');
}

module.exports = {
  SESSION_TTL_HOURS,
  ROLES,
  tokenHash,
  verifyPassword,
  clientAddress,
  audit,
  createAuthenticate,
  requireRole,
  ensureProjectAccess,
};

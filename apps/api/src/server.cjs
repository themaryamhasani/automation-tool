const crypto = require('node:crypto');
const argon2 = require('argon2');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { registerCdeRoutes } = require('./cde/service.cjs');
const { registerApproachRoutes } = require('./approaches/routes.cjs');
const { isApproach } = require('./approaches/constants.cjs');
const { tokenFromRequest, sessionCookie, clearSessionCookie } = require('../../../shared/session-cookie.cjs');
const { createPool } = require('../../../shared/db/search-path.cjs');
const { startRunEventBus } = require('./runs/events.cjs');
const { registerRunRoutes } = require('./runs/routes.cjs');
const { registerReportRoutes } = require('./reports/routes.cjs');
const { registerRuntimeRoutes } = require('./runtime/service.cjs');
const { registerAutomationRoutes } = require('./automation/routes.cjs');
const { registerAnalyticsRoutes } = require('./analytics/routes.cjs');
const { registerPlatformDocRoutes } = require('./platform/routes.cjs');
const { registerGateRoutes } = require('./gates/routes.cjs');
const { registerOpsRoutes } = require('./ops/routes.cjs');
const { startScheduler } = require('./automation/scheduler.cjs');
const { startRetentionWorker } = require('./retention/worker.cjs');
const { loadCdeProjectContext } = require('./cde/project-context.cjs');
const { ApiError, asyncRoute, camelRow, cleanText, parsePositiveInt, pagination, paged } = require('./http.cjs');
const { createAuthenticate } = require('./middleware/auth.cjs');
const { API_TOKEN_PREFIX, EXTENSION_ACCESS_TOKEN_PREFIX, authorizeApiTokenRequest, requireScope, requireSession } = require('./auth/api-token.cjs');
const { registerPublicExtensionRoutes, registerAuthenticatedExtensionRoutes } = require('./extension/routes.cjs');
const { registerRecorderFileRoutes } = require('./files/recorder-routes.cjs');
const { assertSafePlaywrightSource } = require('./files/source-validation.cjs');

const pool = createPool(process.env.DATABASE_URL);
const authenticateApiAware = createAuthenticate(pool);
const { warmTargetsFromDb } = require('../../../shared/runtime/app-targets.cjs');
warmTargetsFromDb(pool).catch((error) => {
  console.error(JSON.stringify({ event: 'project-targets-warm-failed', message: error.message }));
});
const SESSION_TTL_HOURS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 24));
const FILE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.spec\.(?:ts|js)|\.test\.(?:ts|js)|\.js)$/;
const FOLDER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const ROLES = new Set(['ADMIN', 'OPERATOR', 'VIEWER']);
const TRACE_MODES = new Set(['off', 'on', 'retain-on-failure', 'on-first-retry']);
const REPORTERS = new Set(['html', 'json', 'junit']);


function validHttpUrl(value, required = false) {
  const text = cleanText(value, 2000);
  if (!text && !required) return null;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString().replace(/\/$/, '');
  } catch { throw new ApiError(422, 'INVALID_URL', 'آدرس محیط باید یک URL معتبر HTTP یا HTTPS باشد.'); }
}

function environmentAvailability(body) {
  const parse = (value, field) => {
    if (value == null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ApiError(422, 'ENVIRONMENT_AVAILABILITY_INVALID', `مقدار ${field} معتبر نیست.`);
    return date;
  };
  const availableFrom = parse(body?.availableFrom, 'availableFrom');
  const availableUntil = parse(body?.availableUntil, 'availableUntil');
  if (availableFrom && availableUntil && availableUntil <= availableFrom) throw new ApiError(422, 'ENVIRONMENT_AVAILABILITY_INVALID', 'پایان دسترسی باید بعد از شروع دسترسی باشد.');
  return { availableFrom, availableUntil };
}

function environmentSecretReferences(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, 'SECRET_REFERENCES_INVALID', 'Secret referenceها باید یک شیء JSON باشند.');
  const entries = Object.entries(value);
  if (entries.length > 50) throw new ApiError(422, 'SECRET_REFERENCES_INVALID', 'حداکثر ۵۰ Secret reference مجاز است.');
  const result = {};
  for (const [targetName, sourceName] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(targetName) || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(String(sourceName || ''))) throw new ApiError(422, 'SECRET_REFERENCES_INVALID', 'نام متغیرهای Secret باید با الگوی ENV_VARIABLE سازگار باشد.');
    result[targetName] = String(sourceName);
  }
  return result;
}

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

async function authenticate(req, _res, next) {
  const token = tokenFromRequest(req);
  if (!token) return next(new ApiError(401, 'AUTH_REQUIRED', 'برای ادامه وارد سامانه شوید.'));
  if (token.startsWith(API_TOKEN_PREFIX) || token.startsWith(EXTENSION_ACCESS_TOKEN_PREFIX)) return authenticateApiAware(req, _res, next);
  const result = await pool.query(
    `SELECT s.id AS session_id, u.id, u.full_name, u.email, u.phone_number, u.role, u.is_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [tokenHash(token)],
  );
  if (!result.rowCount || !result.rows[0].is_active) {
    return next(new ApiError(401, 'SESSION_EXPIRED', 'نشست شما منقضی شده است.'));
  }
  req.token = token;
  req.user = camelRow(result.rows[0]);
  next();
}

function requireRole(...roles) {
  return (req, _res, next) => roles.includes(req.user.role)
    ? next()
    : next(new ApiError(403, 'ACCESS_DENIED', 'اجازه انجام این عملیات را ندارید.'));
}

async function ensureProjectAccess(user, projectId, write = false) {
  if (!projectId) throw new ApiError(422, 'PROJECT_REQUIRED', 'انتخاب پروژه الزامی است.');
  if (Array.isArray(user.apiTokenProjectIds) && !user.apiTokenProjectIds.includes(projectId)) {
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

function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.runBus = startRunEventBus(pool);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(express.json({ limit: '3mb' }));

  app.get('/api/health', asyncRoute(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'automation-api', time: new Date().toISOString() });
  }));

  registerPublicExtensionRoutes(app, { pool, audit });

  const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
    const identity = cleanText(req.body?.identity, 320);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!identity || !password) throw new ApiError(422, 'CREDENTIALS_REQUIRED', 'نام کاربری و رمز عبور الزامی است.');
    const result = await pool.query(
      `SELECT id, full_name, email, phone_number, password_hash, role, is_active
         FROM users WHERE lower(email) = lower($1) OR phone_number = $1 LIMIT 1`,
      [identity],
    );
    const row = result.rows[0];
    const valid = row ? await verifyPassword(row.password_hash, password) : false;
    if (!valid || !row?.is_active) throw new ApiError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور نادرست است.');
    if (!row.password_hash.startsWith('$argon2')) {
      await pool.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [await argon2.hash(password), row.id]);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.id, tokenHash(token), expiresAt, req.get('user-agent') || null, clientAddress(req)],
    );
    await audit(pool, row.id, 'AUTH_LOGIN', 'USER', row.id, { ip: clientAddress(req) });
    delete row.password_hash;
    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_HOURS * 3600));
    res.json({ token, expiresAt, user: camelRow(row) });
  }));

  app.use('/api', asyncRoute(authenticate));
  app.use('/api', authorizeApiTokenRequest);
  registerAuthenticatedExtensionRoutes(app, { pool, audit, requireRole });
  registerCdeRoutes(app, { pool, audit, ensureProjectAccess });
  registerApproachRoutes(app, { pool, audit, ensureProjectAccess });
  registerRuntimeRoutes(app, { pool, audit, ensureProjectAccess });
  registerAutomationRoutes(app, { pool, audit, ensureProjectAccess });
  registerAnalyticsRoutes(app, { pool, ensureProjectAccess });
  registerPlatformDocRoutes(app);
  registerGateRoutes(app, { pool, audit, ensureProjectAccess });
  const retentionWorker = startRetentionWorker(pool);
  registerOpsRoutes(app, { pool, retentionWorker });
  startScheduler(pool);

  app.get('/api/auth/me', requireScope('profile:read'), asyncRoute(async (req, res) => {
    const projects = await pool.query(
      req.user.role === 'ADMIN'
        ? 'SELECT id FROM projects ORDER BY name'
        : 'SELECT project_id AS id FROM user_projects WHERE user_id = $1 ORDER BY created_at',
      req.user.role === 'ADMIN' ? [] : [req.user.id],
    );
    const projectIds = projects.rows.map(row => row.id);
    res.json({
      user: req.user,
      projectIds: Array.isArray(req.user.apiTokenProjectIds)
        ? projectIds.filter(id => req.user.apiTokenProjectIds.includes(id))
        : projectIds,
    });
  }));

  app.post('/api/auth/logout', requireSession, asyncRoute(async (req, res) => {
    await pool.query('DELETE FROM cde_sessions WHERE session_id = $1', [req.user.sessionId]);
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.user.sessionId]);
    await audit(pool, req.user.id, 'AUTH_LOGOUT', 'USER', req.user.id);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.status(204).end();
  }));

  app.post('/api/auth/change-password', requireSession, asyncRoute(async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 10) throw new ApiError(422, 'WEAK_PASSWORD', 'رمز جدید باید حداقل ۱۰ کاراکتر باشد.');
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!await verifyPassword(result.rows[0].password_hash, currentPassword)) {
      throw new ApiError(422, 'INVALID_CURRENT_PASSWORD', 'رمز عبور فعلی صحیح نیست.');
    }
    const hash = await argon2.hash(newPassword);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.user.id]);
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2', [req.user.id, req.user.sessionId]);
    await audit(pool, req.user.id, 'AUTH_PASSWORD_CHANGED', 'USER', req.user.id);
    res.status(204).end();
  }));

  app.get('/api/projects', requireScope('projects:read'), asyncRoute(async (req, res) => {
    const params = [];
    const access = req.user.role === 'ADMIN' ? '' : 'JOIN user_projects up ON up.project_id = p.id AND up.user_id = $1';
    if (req.user.role !== 'ADMIN') params.push(req.user.id);
    const includeWorkspace = String(req.query?.includeWorkspace || '') === '1';
    const kindFilter = includeWorkspace ? '' : " AND p.kind = 'NAMED'";
    const result = await pool.query(
      `SELECT p.*, count(DISTINCT e.id)::int AS environment_count, count(DISTINCT f.id)::int AS file_count
         FROM projects p ${access}
         LEFT JOIN environments e ON e.project_id = p.id
         LEFT JOIN test_files f ON f.project_id = p.id
        WHERE true${kindFilter}
        GROUP BY p.id ORDER BY p.is_active DESC, p.name`,
      params,
    );
    const rows = Array.isArray(req.user.apiTokenProjectIds)
      ? result.rows.filter(row => req.user.apiTokenProjectIds.includes(row.id))
      : result.rows;
    res.json(rows.map(camelRow));
  }));

  app.post('/api/projects', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const name = cleanText(req.body?.name, 255);
    const code = cleanText(req.body?.code, 80).toLowerCase();
    const sourceApproach = isApproach(String(req.body?.sourceApproach || 'CDE').toUpperCase())
      ? String(req.body?.sourceApproach || 'CDE').toUpperCase() : 'CDE';
    if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(code)) throw new ApiError(422, 'INVALID_PROJECT', 'نام و کد انگلیسی معتبر وارد کنید.');
    if (/^ws-/.test(code)) throw new ApiError(422, 'WORKSPACE_CODE_RESERVED', 'کدهای ws-* برای فضای کار سیستمی رزرو شده‌اند.');
    const result = await pool.query(
      `INSERT INTO projects (name, code, description, source_approach, kind) VALUES ($1, $2, $3, $4, 'NAMED') RETURNING *`,
      [name, code, cleanText(req.body?.description, 5000) || null, sourceApproach],
    );
    await audit(pool, req.user.id, 'PROJECT_CREATED', 'PROJECT', result.rows[0].id);
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/projects/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const name = cleanText(req.body?.name, 255);
    const code = cleanText(req.body?.code, 80).toLowerCase();
    const sourceApproach = isApproach(String(req.body?.sourceApproach || 'CDE').toUpperCase())
      ? String(req.body?.sourceApproach || 'CDE').toUpperCase() : 'CDE';
    if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(code)) throw new ApiError(422, 'INVALID_PROJECT', 'نام و کد انگلیسی معتبر وارد کنید.');
    const existing = await pool.query('SELECT id, kind FROM projects WHERE id=$1', [req.params.id]);
    if (!existing.rowCount) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'پروژه پیدا نشد.');
    if (existing.rows[0].kind === 'WORKSPACE') {
      throw new ApiError(409, 'WORKSPACE_PROJECT_READONLY', 'پروژه‌های فضای کار سیستمی از این مسیر ویرایش نمی‌شوند.');
    }
    if (/^ws-/.test(code)) throw new ApiError(422, 'WORKSPACE_CODE_RESERVED', 'کدهای ws-* برای فضای کار سیستمی رزرو شده‌اند.');
    const result = await pool.query(
      `UPDATE projects SET name=$1, code=$2, description=$3, is_active=$4, source_approach=$5, kind='NAMED', updated_at=now()
        WHERE id=$6 AND kind='NAMED' RETURNING *`,
      [name, code, cleanText(req.body?.description, 5000) || null, req.body?.isActive !== false, sourceApproach, req.params.id],
    );
    if (!result.rowCount) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'پروژه پیدا نشد.');
    await audit(pool, req.user.id, 'PROJECT_UPDATED', 'PROJECT', req.params.id);
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/projects/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const existing = await pool.query('SELECT id, name, is_active, kind FROM projects WHERE id=$1', [req.params.id]);
    if (!existing.rowCount) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'پروژه پیدا نشد.');
    if (existing.rows[0].kind === 'WORKSPACE') {
      throw new ApiError(409, 'WORKSPACE_PROJECT_READONLY', 'پروژه‌های فضای کار سیستمی حذف نمی‌شوند.');
    }
    const runCount = await pool.query('SELECT count(*)::int AS total FROM runs WHERE project_id=$1', [req.params.id]);
    if (runCount.rows[0].total > 0) {
      const archived = await pool.query(
        `UPDATE projects SET is_active=false, updated_at=now() WHERE id=$1 RETURNING *`,
        [req.params.id],
      );
      await audit(pool, req.user.id, 'PROJECT_ARCHIVED', 'PROJECT', req.params.id, { reason: 'HAS_RUNS', runCount: runCount.rows[0].total });
      res.json({ ...camelRow(archived.rows[0]), archived: true, deleted: false, runCount: runCount.rows[0].total });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
      await audit(client, req.user.id, 'PROJECT_DELETED', 'PROJECT', req.params.id, { name: existing.rows[0].name });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.json({ id: req.params.id, deleted: true, archived: false });
  }));

  app.get('/api/projects/:projectId/environments', requireScope('projects:read'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    const result = await pool.query("SELECT *, (enabled AND (available_from IS NULL OR available_from<=now()) AND (available_until IS NULL OR available_until>now())) AS available_now FROM environments WHERE project_id=$1 ORDER BY enabled DESC, name", [req.params.projectId]);
    res.json(result.rows.map(row => { const serialized = camelRow(row); if (req.user.role !== 'ADMIN') delete serialized.secretReferences; return serialized; }));
  }));

  app.post('/api/projects/:projectId/environments', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const name = cleanText(req.body?.name, 120);
    const baseUrl = validHttpUrl(req.body?.baseUrl, true);
    const availability = environmentAvailability(req.body);
    if (!name) throw new ApiError(422, 'ENVIRONMENT_NAME_REQUIRED', 'نام محیط الزامی است.');
    const result = await pool.query(
      `INSERT INTO environments (project_id,name,base_url,api_base_url,gateway_base_url,secret_references,enabled,available_from,available_until)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING *`,
      [req.params.projectId, name, baseUrl, validHttpUrl(req.body?.apiBaseUrl), validHttpUrl(req.body?.gatewayBaseUrl), JSON.stringify(environmentSecretReferences(req.body?.secretReferences)), req.body?.enabled !== false, availability.availableFrom, availability.availableUntil],
    );
    await audit(pool, req.user.id, 'ENVIRONMENT_CREATED', 'ENVIRONMENT', result.rows[0].id, { projectId: req.params.projectId });
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/environments/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const name = cleanText(req.body?.name, 120);
    const baseUrl = validHttpUrl(req.body?.baseUrl, true);
    const availability = environmentAvailability(req.body);
    const result = await pool.query(
      `UPDATE environments SET name=$1,base_url=$2,api_base_url=$3,gateway_base_url=$4,secret_references=$5::jsonb,enabled=$6,available_from=$7,available_until=$8,updated_at=now()
        WHERE id=$9 RETURNING *`,
      [name, baseUrl, validHttpUrl(req.body?.apiBaseUrl), validHttpUrl(req.body?.gatewayBaseUrl), JSON.stringify(environmentSecretReferences(req.body?.secretReferences)), req.body?.enabled !== false, availability.availableFrom, availability.availableUntil, req.params.id],
    );
    if (!result.rowCount) throw new ApiError(404, 'ENVIRONMENT_NOT_FOUND', 'محیط پیدا نشد.');
    await audit(pool, req.user.id, 'ENVIRONMENT_UPDATED', 'ENVIRONMENT', req.params.id);
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/environments/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const result = await pool.query('DELETE FROM environments WHERE id=$1 RETURNING project_id', [req.params.id]);
    if (!result.rowCount) throw new ApiError(404, 'ENVIRONMENT_NOT_FOUND', 'محیط پیدا نشد.');
    await audit(pool, req.user.id, 'ENVIRONMENT_DELETED', 'ENVIRONMENT', req.params.id);
    res.status(204).end();
  }));

  app.get('/api/users', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone_number, u.role, u.is_active, u.created_at, u.updated_at,
              coalesce(array_agg(up.project_id) FILTER (WHERE up.project_id IS NOT NULL), '{}') AS project_ids
         FROM users u LEFT JOIN user_projects up ON up.user_id = u.id
        GROUP BY u.id ORDER BY u.is_active DESC, u.full_name`,
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/users', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 255);
    const email = cleanText(req.body?.email, 320).toLowerCase() || null;
    const phone = cleanText(req.body?.phoneNumber, 32) || null;
    const password = String(req.body?.password || '');
    const role = ROLES.has(req.body?.role) ? req.body.role : 'VIEWER';
    if (!fullName || (!email && !phone)) throw new ApiError(422, 'INVALID_USER', 'نام و حداقل ایمیل یا شماره همراه الزامی است.');
    if (password.length < 10) throw new ApiError(422, 'WEAK_PASSWORD', 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO users (full_name,email,phone_number,password_hash,role) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [fullName, email, phone, await argon2.hash(password), role],
      );
      const projectIds = Array.isArray(req.body?.projectIds) ? [...new Set(req.body.projectIds)] : [];
      for (const projectId of projectIds) {
        await client.query('INSERT INTO user_projects (user_id,project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [result.rows[0].id, projectId]);
      }
      await audit(client, req.user.id, 'USER_CREATED', 'USER', result.rows[0].id, { role });
      await client.query('COMMIT');
      delete result.rows[0].password_hash;
      res.status(201).json({ ...camelRow(result.rows[0]), projectIds });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  app.put('/api/users/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 255);
    const email = cleanText(req.body?.email, 320).toLowerCase() || null;
    const phone = cleanText(req.body?.phoneNumber, 32) || null;
    const role = ROLES.has(req.body?.role) ? req.body.role : 'VIEWER';
    const isActive = req.body?.isActive !== false;
    if (!fullName || (!email && !phone)) throw new ApiError(422, 'INVALID_USER', 'اطلاعات کاربر کامل نیست.');
    if (req.params.id === req.user.id && (!isActive || role !== 'ADMIN')) {
      throw new ApiError(422, 'SELF_ADMIN_REQUIRED', 'نمی‌توانید دسترسی مدیر جاری را حذف کنید.');
    }
    const password = String(req.body?.password || '');
    if (password && password.length < 10) throw new ApiError(422, 'WEAK_PASSWORD', 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const passwordClause = password ? ', password_hash=$7' : '';
      const params = [fullName, email, phone, role, isActive, req.params.id];
      if (password) params.push(await argon2.hash(password));
      const result = await client.query(
        `UPDATE users SET full_name=$1,email=$2,phone_number=$3,role=$4,is_active=$5,updated_at=now()${passwordClause}
          WHERE id=$6 RETURNING id,full_name,email,phone_number,role,is_active,created_at,updated_at`,
        params,
      );
      if (!result.rowCount) throw new ApiError(404, 'USER_NOT_FOUND', 'کاربر پیدا نشد.');
      await client.query(
        `DELETE FROM user_projects up
          USING projects p
         WHERE up.user_id = $1 AND up.project_id = p.id AND p.kind = 'NAMED'`,
        [req.params.id],
      );
      const projectIds = Array.isArray(req.body?.projectIds) ? [...new Set(req.body.projectIds)] : [];
      for (const projectId of projectIds) {
        const kind = await client.query('SELECT kind FROM projects WHERE id = $1', [projectId]);
        if (!kind.rowCount || kind.rows[0].kind === 'WORKSPACE') continue;
        await client.query('INSERT INTO user_projects (user_id,project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, projectId]);
      }
      if (!isActive) await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [req.params.id]);
      await audit(client, req.user.id, 'USER_UPDATED', 'USER', req.params.id, { role, isActive });
      await client.query('COMMIT');
      res.json({ ...camelRow(result.rows[0]), projectIds });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  registerRecorderFileRoutes(app, { pool, audit, ensureProjectAccess });

  app.get('/api/files', requireScope('files:read'), asyncRoute(async (req, res) => {
    const projectId = String(req.query.projectId || '');
    await ensureProjectAccess(req.user, projectId);
    const { page, limit, offset } = pagination(req.query);
    const search = cleanText(req.query.search, 500);
    const where = search ? `AND (f.file_name ILIKE $2 OR f.folder_path ILIKE $2 OR f.description ILIKE $2 OR f.source_code ILIKE $2)` : '';
    const params = search ? [projectId, `%${search}%`] : [projectId];
    const count = await pool.query(`SELECT count(*)::int AS total FROM test_files f WHERE f.project_id=$1 ${where}`, params);
    const result = await pool.query(
      `SELECT f.*, p.name AS project_name, u.full_name AS created_by_name
         FROM test_files f JOIN projects p ON p.id=f.project_id JOIN users u ON u.id=f.created_by
        WHERE f.project_id=$1 ${where} ORDER BY f.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    res.json(paged(result.rows.map(row => ({ ...camelRow(row), fullPath: `${row.folder_path}/${row.file_name}` })), count.rows[0].total, page, limit));
  }));

  app.get('/api/files/folders', requireScope('files:read'), asyncRoute(async (req, res) => {
    const projectId = String(req.query.projectId || '');
    await ensureProjectAccess(req.user, projectId);
    const result = await pool.query('SELECT folder_path, count(*)::int AS file_count FROM test_files WHERE project_id=$1 GROUP BY folder_path ORDER BY folder_path', [projectId]);
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/files', requireScope('files:write'), asyncRoute(async (req, res) => {
    const projectId = String(req.body?.projectId || '');
    await ensureProjectAccess(req.user, projectId, true);
    const project = await pool.query('SELECT source_approach FROM projects WHERE id=$1', [projectId]);
    const cdeContext = project.rows[0]?.source_approach === 'CDE'
      ? await loadCdeProjectContext(pool, req.user, projectId, { requireConnection: false, required: false })
      : { projectKey: null, format: 1 };
    const folderPath = cleanText(req.body?.folderPath, 500).replace(/^\/+|\/+$/g, '') || 'tests';
    const fileName = cleanText(req.body?.fileName, 255).toLowerCase();
    const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : '';
    if (!FOLDER_PATTERN.test(folderPath)) throw new ApiError(422, 'INVALID_FOLDER', 'مسیر پوشه معتبر نیست.');
    if (!FILE_NAME_PATTERN.test(fileName)) throw new ApiError(422, 'INVALID_FILE_NAME', 'نام فایل Playwright معتبر نیست.');
    if (!sourceCode.trim() || Buffer.byteLength(sourceCode) > 2 * 1024 * 1024) throw new ApiError(422, 'INVALID_SOURCE', 'محتوای فایل الزامی و حداکثر دو مگابایت است.');
    assertSafePlaywrightSource(sourceCode);
    const result = await pool.query(
      `INSERT INTO test_files (project_id,folder_path,file_name,description,source_code,created_by,cde_project_key,cde_binding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
      [projectId, folderPath, fileName, cleanText(req.body?.description, 700) || null, sourceCode, req.user.id, cdeContext.projectKey, JSON.stringify(cdeContext)],
    );
    await audit(pool, req.user.id, 'TEST_FILE_CREATED', 'TEST_FILE', result.rows[0].id, { projectId, path: `${folderPath}/${fileName}`, origin: cleanText(req.body?.origin, 40) || 'web' });
    res.status(201).json({ ...camelRow(result.rows[0]), fullPath: `${folderPath}/${fileName}` });
  }));

  app.get('/api/files/:id', requireScope('files:read'), asyncRoute(async (req, res) => {
    const current = await pool.query(
      `SELECT f.*, p.name AS project_name FROM test_files f JOIN projects p ON p.id=f.project_id WHERE f.id=$1`,
      [req.params.id],
    );
    if (!current.rowCount) throw new ApiError(404, 'FILE_NOT_FOUND', 'فایل پیدا نشد.');
    await ensureProjectAccess(req.user, current.rows[0].project_id);
    const row = current.rows[0];
    res.json({
      ...camelRow(row),
      fullPath: `${row.folder_path}/${row.file_name}`,
      path: `${row.folder_path}/${row.file_name}`,
      name: row.file_name,
      code: row.source_code,
    });
  }));

  app.put('/api/files/:id', requireScope('files:write'), asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT * FROM test_files WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw new ApiError(404, 'FILE_NOT_FOUND', 'فایل پیدا نشد.');
    await ensureProjectAccess(req.user, current.rows[0].project_id, true);
    const project = await pool.query('SELECT source_approach FROM projects WHERE id=$1', [current.rows[0].project_id]);
    const cdeContext = project.rows[0]?.source_approach === 'CDE'
      ? await loadCdeProjectContext(pool, req.user, current.rows[0].project_id, { requireConnection: false, required: false })
      : { projectKey: null, format: 1 };
    const folderPath = cleanText(req.body?.folderPath, 500).replace(/^\/+|\/+$/g, '');
    const fileName = cleanText(req.body?.fileName, 255).toLowerCase();
    const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : '';
    const expectedRevision = Number(req.body?.revision);
    if (!FOLDER_PATTERN.test(folderPath) || !FILE_NAME_PATTERN.test(fileName) || !sourceCode.trim()) throw new ApiError(422, 'INVALID_FILE', 'اطلاعات فایل معتبر نیست.');
    assertSafePlaywrightSource(sourceCode);
    const result = await pool.query(
      `UPDATE test_files SET folder_path=$1,file_name=$2,description=$3,source_code=$4,revision=revision+1,updated_by=$5,
                             cde_project_key=$6,cde_binding=$7::jsonb,updated_at=now()
        WHERE id=$8 AND revision=$9 RETURNING *`,
      [folderPath, fileName, cleanText(req.body?.description, 700) || null, sourceCode, req.user.id, cdeContext.projectKey, JSON.stringify(cdeContext), req.params.id, expectedRevision],
    );
    if (!result.rowCount) throw new ApiError(409, 'REVISION_CONFLICT', 'فایل توسط کاربر دیگری تغییر کرده است؛ دوباره بارگذاری کنید.');
    await audit(pool, req.user.id, 'TEST_FILE_UPDATED', 'TEST_FILE', req.params.id, { revision: result.rows[0].revision, origin: cleanText(req.body?.origin, 40) || 'web' });
    res.json({ ...camelRow(result.rows[0]), fullPath: `${folderPath}/${fileName}` });
  }));

  app.delete('/api/files/:id', requireScope('files:write'), asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT project_id FROM test_files WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw new ApiError(404, 'FILE_NOT_FOUND', 'فایل پیدا نشد.');
    await ensureProjectAccess(req.user, current.rows[0].project_id, true);
    await pool.query('DELETE FROM test_files WHERE id=$1', [req.params.id]);
    await audit(pool, req.user.id, 'TEST_FILE_DELETED', 'TEST_FILE', req.params.id);
    res.status(204).end();
  }));

  registerRunRoutes(app, { pool, audit, ensureProjectAccess });
  registerReportRoutes(app, { pool, audit, ensureProjectAccess });

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

  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'مسیر درخواستی پیدا نشد.')));
  app.use((error, _req, res, _next) => {
    if (error.code === '23505') error = new ApiError(409, 'DUPLICATE_VALUE', 'رکوردی با این مقدار از قبل وجود دارد.');
    if (error.code === '23503') error = new ApiError(409, 'ENTITY_IN_USE', 'این رکورد در بخش دیگری استفاده شده و قابل حذف نیست.');
    const status = Number(error.status) || 500;
    const code = error.code || 'INTERNAL_ERROR';
    const expose = status < 500 || String(code).startsWith('CDE_');
    if (status >= 500) console.error(error);
    res.status(status).json({ code, message: expose ? (error.message || 'خطای داخلی سرور رخ داد.') : 'خطای داخلی سرور رخ داد.', details: error.details });
  });
  return app;
}

module.exports = { createServer, pool };

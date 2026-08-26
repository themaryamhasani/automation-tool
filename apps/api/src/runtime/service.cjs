const {
  RuntimeClientError,
  executeCoreOperation,
  finishRuntimeLogin,
  normalizedProfile,
  parseRuntimeOrigin,
  publicRuntimeStatus,
  startRuntimeLogin,
} = require('./runtime-core-client.cjs');
const { connectFromImport } = require('./auth-handoff.cjs');
const {
  createLoginChallenge,
  deleteRuntimeSession,
  getRuntimeSession,
  readLoginChallenge,
  setRuntimeSession,
} = require('./session-store.cjs');
const { ensureWorkspaceProject, ensureEnvironment } = require('../runs/create-run.cjs');
const {
  AUTH_MODE_DEVLOGIN,
  AUTH_MODE_SOHA_HANDOFF,
  configuredOrigins,
  resolveAppTarget,
  normalizeSourceId,
  getApiFixture,
} = require('../../../../shared/runtime/app-targets.cjs');

const DEFAULT_RUNTIME_ORIGIN = 'https://soha.m.edus.ir';
const MEDUS_ENV_NAME = 'm-edus';

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

class RuntimeError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normalizeLogin(value) {
  const digits = String(value || '').trim()
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s()-]/g, '');
  const local = digits.replace(/^\+98/, '').replace(/^0098/, '').replace(/^98/, '').replace(/^0(?=9)/, '');
  return /^9\d{9}$/.test(local) ? local : '';
}

function displayUser(user) {
  if (!user || typeof user !== 'object') return null;
  return {
    firstName: String(user.firstName || ''),
    lastName: String(user.lastName || ''),
    displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
  };
}

function configuredDefaultOrigins() {
  return configuredOrigins();
}

function isMedusOrigin(value) {
  try {
    return /\.m\.edus\.ir$/i.test(new URL(String(value || '')).hostname);
  } catch {
    return false;
  }
}

function isMeduOrigin(value) {
  try {
    return /\.medu\.ir$/i.test(new URL(String(value || '')).hostname);
  } catch {
    return false;
  }
}

function isAllowedRuntimeOrigin(value, projectKey = null, authMode = null) {
  if (isMedusOrigin(value)) return true;
  const target = resolveAppTarget(projectKey, { authMode: authMode || undefined });
  try {
    parseRuntimeOrigin(value, { allowlist: target.originAllowlist || [] });
    return true;
  } catch {
    return false;
  }
}

function candidateOriginsFromEnvironment(environment, projectKey = null, authMode = null) {
  const target = resolveAppTarget(projectKey, { authMode: authMode || undefined });
  const fromEnv = [environment?.gateway_base_url, environment?.base_url, environment?.api_base_url]
    .map(value => String(value || '').trim().replace(/\/$/, ''))
    .filter(value => value && (isMedusOrigin(value) || (target.authMode === AUTH_MODE_SOHA_HANDOFF && isMeduOrigin(value))));
  const fromTarget = [
    target.appOrigin,
    target.authOrigin,
    target.origin,
    ...(target.cookieScopes || []),
  ].filter(Boolean);
  // Keep global defaults only when no projectKey; otherwise stick to this pack's profile
  // so e.g. medu-camp does not list tavan.medu.ir (previous / other product origins).
  const fromConfigured = projectKey
    ? configuredDefaultOrigins().filter(origin => isAllowedRuntimeOrigin(origin, projectKey, authMode || target.authMode))
    : configuredDefaultOrigins();
  return Array.from(new Set([...fromEnv, ...fromTarget, ...fromConfigured]));
}

function runtimeOriginOf(environment, requestedOrigin, projectKey = null, authMode = null) {
  const target = resolveAppTarget(projectKey, { authMode: authMode || undefined, origin: requestedOrigin || undefined });
  const candidates = candidateOriginsFromEnvironment(environment, projectKey, authMode || target.authMode);
  const requested = String(requestedOrigin || '').trim().replace(/\/$/, '');
  if (requested) {
    if (!candidates.includes(requested) && !isAllowedRuntimeOrigin(requested, projectKey, authMode || target.authMode)) {
      throw new RuntimeError('RUNTIME_ORIGIN_NOT_ALLOWED', 'Origin رانتایم در allowlist این پروفایل نیست.', 403);
    }
    return requested;
  }
  if (target.authMode === AUTH_MODE_SOHA_HANDOFF && target.appOrigin) return target.appOrigin;
  if (!candidates.length) {
    throw new RuntimeError(
      'RUNTIME_ORIGIN_REQUIRED',
      'هیچ origin رانتایمی تنظیم نشده است. RUNTIME_DEFAULT_ORIGINS را روی https://soha.m.edus.ir بگذارید.',
      422,
    );
  }
  return candidates[0];
}

function profileFromEnvironment(environment, requestedOrigin, projectKey = null, authMode = null) {
  const target = resolveAppTarget(projectKey, {
    authMode: authMode || undefined,
    origin: requestedOrigin || undefined,
  });
  const explicitOrigin = String(requestedOrigin || '').trim() || (
    target.authMode === AUTH_MODE_SOHA_HANDOFF ? target.appOrigin : ''
  );
  const origin = runtimeOriginOf(environment, explicitOrigin || null, projectKey, target.authMode);
  const parsed = parseRuntimeOrigin(origin, { allowlist: target.originAllowlist || [] });
  const appOrigin = target.authMode === AUTH_MODE_SOHA_HANDOFF
    ? (target.appOrigin || parsed.origin)
    : parsed.origin;
  const authOrigin = target.authMode === AUTH_MODE_SOHA_HANDOFF
    ? (target.authOrigin || parsed.origin)
    : parsed.origin;
  return normalizedProfile({
    id: environment.id,
    origin: target.authMode === AUTH_MODE_SOHA_HANDOFF ? appOrigin : parsed.origin,
    runtimeServiceId: new URL(appOrigin).host,
    projectServiceId: target.projectServiceId || '',
    loginPath: target.loginPath == null ? null : (target.loginPath || process.env.RUNTIME_DEFAULT_LOGIN_PATH || '/devlogin'),
    coreBasePath: process.env.RUNTIME_DEFAULT_CORE_BASE_PATH || '/core-api/v1',
    appRefererPath: target.appPath || '/',
    userSource: process.env.RUNTIME_DEFAULT_USER_SOURCE || 'medugovir',
    authMode: target.authMode || AUTH_MODE_DEVLOGIN,
    authOrigin,
    appOrigin,
    prostage: target.prostage || null,
    originAllowlist: target.originAllowlist || [],
    readyCheck: target.readyCheck,
    handoff: target.handoff,
  });
}

function mapRuntimeError(error) {
  if (error instanceof RuntimeError) return error;
  if (error instanceof RuntimeClientError) {
    return new RuntimeError(error.category, error.message, error.statusCode || 502, error.details);
  }
  return error;
}

async function loadEnvironment(pool, ensureProjectAccess, user, environmentId) {
  const result = await pool.query(
    `SELECT e.id, e.project_id, e.name, e.base_url, e.api_base_url, e.gateway_base_url, e.enabled
       FROM environments e
      WHERE e.id=$1`,
    [environmentId],
  );
  if (!result.rowCount) throw new RuntimeError('ENVIRONMENT_NOT_FOUND', 'محیط اجرا پیدا نشد.', 404);
  const environment = result.rows[0];
  await ensureProjectAccess(user, environment.project_id);
  if (!environment.enabled) throw new RuntimeError('ENVIRONMENT_DISABLED', 'این محیط غیرفعال است.', 409);
  return environment;
}

async function resolveWorkspaceMedusEnvironment(pool, user, projectKey, origin, authMode = null) {
  const key = String(projectKey || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(key)) {
    throw new RuntimeError('CDE_PROJECT_INVALID', 'کلید پروژه CDE معتبر نیست.', 422);
  }
  const workspace = await ensureWorkspaceProject(pool, user, 'CDE');
  const preferred = resolveAppTarget(key, { origin, authMode: authMode || undefined });
  const resolvedOrigin = runtimeOriginOf(
    { base_url: origin || preferred.appOrigin || preferred.origin || configuredDefaultOrigins()[0] },
    origin || preferred.appOrigin || preferred.origin,
    key,
    preferred.authMode,
  );
  let environment = await ensureEnvironment(pool, workspace.id, MEDUS_ENV_NAME, resolvedOrigin);
  if (String(environment.base_url || '').replace(/\/$/, '') !== resolvedOrigin) {
    const updated = await pool.query(
      `UPDATE environments SET base_url=$1, gateway_base_url=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [resolvedOrigin, environment.id],
    );
    environment = updated.rows[0];
  }
  return { workspace, environment, projectKey: key, origin: resolvedOrigin, authMode: preferred.authMode };
}

function sessionPayload(environment, state, origin, extra = {}) {
  const projectKey = extra.projectKey || state?.projectKey || null;
  const authMode = extra.authMode || state?.authMode || null;
  const target = resolveAppTarget(projectKey, {
    origin: origin || state?.appOrigin || state?.origin,
    authMode: authMode || undefined,
  });
  const profileOrigin = origin || state?.appOrigin || state?.origin || runtimeOriginOf(environment, null, projectKey, target.authMode);
  return {
    ...publicRuntimeStatus(state),
    environmentId: environment.id,
    environmentName: environment.name,
    origin: profileOrigin,
    authOrigin: state?.authOrigin || target.authOrigin || profileOrigin,
    appOrigin: state?.appOrigin || target.appOrigin || profileOrigin,
    authMode: state?.authMode || target.authMode,
    authModes: target.authModes || [AUTH_MODE_DEVLOGIN],
    prostage: state?.prostage || target.prostage || null,
    handoff: target.handoff || null,
    cookieScopes: target.cookieScopes || [profileOrigin],
    readyCheck: target.readyCheck || null,
    origins: candidateOriginsFromEnvironment(environment, projectKey, target.authMode),
    loginPath: target.loginPath,
    loginUrl: target.loginUrl,
    appPath: target.appPath,
    appUrl: target.appUrl,
    projectServiceId: target.projectServiceId || null,
    apiFixtures: target.apiFixtures || {},
    roleLandings: target.roleLandings,
    userSource: process.env.RUNTIME_DEFAULT_USER_SOURCE || 'medugovir',
    ...extra,
  };
}

function sessionPackKey(target, state = null) {
  return String(target?.projectKey || state?.projectKey || '').trim();
}

function registerSessionHandlers(app, { pool, audit }, resolveTarget) {
  app.get(resolveTarget.path, asyncRoute(async (req, res) => {
    const authMode = String(req.query?.authMode || '').trim() || null;
    const target = await resolveTarget.get(req, req.query?.origin, authMode);
    const packKey = sessionPackKey(target);
    const state = await getRuntimeSession(pool, req.user.id, target.environment.id, packKey);
    res.json(sessionPayload(target.environment, state, state?.appOrigin || state?.origin || target.origin, {
      projectKey: target.projectKey,
      authMode: state?.authMode || target.authMode || authMode,
    }));
  }));

  app.delete(resolveTarget.path, asyncRoute(async (req, res) => {
    const target = await resolveTarget.get(req);
    const packKey = sessionPackKey(target);
    await deleteRuntimeSession(pool, req.user.id, target.environment.id, packKey);
    await audit(pool, req.user.id, 'RUNTIME_SESSION_DISCONNECTED', 'ENVIRONMENT', target.environment.id, {
      projectKey: target.projectKey,
      packKey,
    });
    const resolved = resolveAppTarget(target.projectKey);
    res.json({
      connected: false,
      environmentId: target.environment.id,
      projectKey: target.projectKey,
      authModes: resolved.authModes || [AUTH_MODE_DEVLOGIN],
      origins: candidateOriginsFromEnvironment(target.environment, target.projectKey),
    });
  }));

  app.post(`${resolveTarget.path}/start`, asyncRoute(async (req, res) => {
    const authMode = String(req.body?.authMode || '').trim() || null;
    const target = await resolveTarget.get(req, req.body?.origin, authMode);
    const packKey = sessionPackKey(target);
    if ((target.authMode || authMode) === AUTH_MODE_SOHA_HANDOFF) {
      throw new RuntimeError(
        'RUNTIME_AUTH_MODE_UNSUPPORTED',
        'برای soha-gov-sso-handoff از /import با storageState یا handoff استفاده کنید (SSO دولت کپچا/OTP دارد).',
        422,
      );
    }
    const loginName = normalizeLogin(req.body?.userLoginName || req.body?.phone);
    if (!loginName) throw new RuntimeError('RUNTIME_LOGIN_NAME_INVALID', 'شماره همراه معتبر وارد کنید.', 422);
    const profile = profileFromEnvironment(target.environment, req.body?.origin || target.origin, target.projectKey, authMode);
    await deleteRuntimeSession(pool, req.user.id, target.environment.id, packKey);
    try {
      const result = await startRuntimeLogin(profile, loginName);
      result.state.origin = profile.origin;
      result.state.appOrigin = profile.appOrigin;
      result.state.authOrigin = profile.authOrigin;
      result.state.authMode = profile.authMode;
      result.state.projectKey = target.projectKey || null;
      const ttl = result.state.phase === 'PASSWORD_REQUIRED' ? 5 * 60 : undefined;
      await setRuntimeSession(pool, req.user.id, target.environment.id, result.state, ttl, packKey);
      if (result.status.connected) {
        await audit(pool, req.user.id, 'RUNTIME_LOGIN_COMPLETED', 'ENVIRONMENT', target.environment.id, {
          origin: profile.origin,
          projectKey: target.projectKey,
          authMode: profile.authMode,
        });
        return res.json({
          ...sessionPayload(target.environment, result.state, profile.appOrigin || profile.origin, {
            projectKey: target.projectKey,
            authMode: profile.authMode,
          }),
          runtimeUser: displayUser(result.state.runtimeUser),
        });
      }
      res.json({
        ...sessionPayload(target.environment, result.state, profile.origin, {
          projectKey: target.projectKey,
          authMode: profile.authMode,
        }),
        connected: false,
        nextStep: 'password',
        challenge: createLoginChallenge(req.user.id, target.environment.id, loginName, packKey),
      });
    } catch (error) {
      throw mapRuntimeError(error);
    }
  }));

  app.post(`${resolveTarget.path}/import`, asyncRoute(async (req, res) => {
    const authMode = String(req.body?.authMode || AUTH_MODE_SOHA_HANDOFF).trim() || AUTH_MODE_SOHA_HANDOFF;
    const target = await resolveTarget.get(req, req.body?.appOrigin || req.body?.origin, authMode);
    const packKey = sessionPackKey(target);
    if (!target.projectKey) {
      throw new RuntimeError('RUNTIME_PROJECT_REQUIRED', 'import چنددامنه‌ای به projectKey نیاز دارد.', 422);
    }
    await deleteRuntimeSession(pool, req.user.id, target.environment.id, packKey);
    try {
      const result = await connectFromImport(target.projectKey, {
        authMode,
        storageState: req.body?.storageState,
        cookies: req.body?.cookies,
        handoffUrl: req.body?.handoffUrl,
        tokenId: req.body?.tokenId || req.body?.handoffTokenId,
        forceHandoff: Boolean(req.body?.forceHandoff),
        prostage: req.body?.prostage,
        profileId: target.environment.id,
        appOrigin: req.body?.appOrigin,
        authOrigin: req.body?.authOrigin,
        clientAccessId: req.body?.clientAccessId,
      });
      result.state.projectKey = target.projectKey;
      await setRuntimeSession(pool, req.user.id, target.environment.id, result.state, undefined, packKey);
      await audit(pool, req.user.id, 'RUNTIME_LOGIN_IMPORTED', 'ENVIRONMENT', target.environment.id, {
        origin: result.state.appOrigin || result.state.origin,
        authOrigin: result.state.authOrigin,
        projectKey: target.projectKey,
        authMode: result.state.authMode,
      });
      res.json({
        ...sessionPayload(target.environment, result.state, result.state.appOrigin || result.state.origin, {
          projectKey: target.projectKey,
          authMode: result.state.authMode,
        }),
        runtimeUser: displayUser(result.state.runtimeUser),
      });
    } catch (error) {
      throw mapRuntimeError(error);
    }
  }));

  app.post(`${resolveTarget.path}/password`, asyncRoute(async (req, res) => {
    const authMode = String(req.body?.authMode || '').trim() || null;
    const target = await resolveTarget.get(req, req.body?.origin, authMode);
    const packKey = sessionPackKey(target);
    const password = String(req.body?.password || '');
    if (!password || !req.body?.challenge) throw new RuntimeError('RUNTIME_PASSWORD_REQUIRED', 'رمز عبور و challenge الزامی است.', 422);
    let loginName;
    try { loginName = readLoginChallenge(req.user.id, target.environment.id, String(req.body.challenge), packKey); }
    catch { throw new RuntimeError('RUNTIME_LOGIN_CHALLENGE_EXPIRED', 'زمان ورود تمام شده است؛ دوباره شروع کنید.', 401); }
    const state = await getRuntimeSession(pool, req.user.id, target.environment.id, packKey);
    if (!state) throw new RuntimeError('RUNTIME_LOGIN_NOT_STARTED', 'ابتدا ورود رانتایم را شروع کنید.', 409);
    const profile = profileFromEnvironment(
      target.environment,
      req.body?.origin || state.origin || target.origin,
      target.projectKey || state.projectKey,
      authMode || state.authMode,
    );
    try {
      const result = await finishRuntimeLogin(state, profile, password);
      result.state.origin = profile.origin;
      result.state.appOrigin = profile.appOrigin;
      result.state.authOrigin = profile.authOrigin;
      result.state.authMode = profile.authMode;
      result.state.projectKey = target.projectKey || null;
      await setRuntimeSession(pool, req.user.id, target.environment.id, result.state, undefined, packKey);
      await audit(pool, req.user.id, 'RUNTIME_LOGIN_COMPLETED', 'ENVIRONMENT', target.environment.id, {
        origin: profile.origin,
        projectKey: target.projectKey,
        authMode: profile.authMode,
      });
      res.json({
        ...sessionPayload(target.environment, result.state, profile.appOrigin || profile.origin, {
          projectKey: target.projectKey,
          authMode: profile.authMode,
        }),
        runtimeUser: displayUser(result.state.runtimeUser),
        loginName,
      });
    } catch (error) {
      await setRuntimeSession(pool, req.user.id, target.environment.id, state, 5 * 60, packKey);
      const mapped = mapRuntimeError(error);
      if (mapped.code === 'RUNTIME_INVALID_CREDENTIALS' || mapped.code === 'RUNTIME_LOGICAL_ERROR') {
        throw new RuntimeError('RUNTIME_INVALID_CREDENTIALS', 'رمز عبور رانتایم پذیرفته نشد.', 401);
      }
      throw mapped;
    }
  }));

  // API-CONSOLE style: query get-data-source with projectServiceId + params after runtime login
  app.post(`${resolveTarget.path}/query`, asyncRoute(async (req, res) => {
    const target = await resolveTarget.get(req, req.body?.origin);
    const packKey = sessionPackKey(target);
    const state = await getRuntimeSession(pool, req.user.id, target.environment.id, packKey);
    if (!state || state.phase !== 'CONNECTED') {
      throw new RuntimeError('RUNTIME_SESSION_REQUIRED', 'ابتدا ورود رانتایم را کامل کنید.', 401);
    }
    const projectKey = target.projectKey || state.projectKey || req.body?.projectKey || null;
    const fixtureName = String(req.body?.fixture || '').trim();
    const fixture = fixtureName ? getApiFixture(projectKey, fixtureName) : null;
    const sourceId = normalizeSourceId(
      req.body?.sourceId || req.body?.key || fixture?.sourceId || '',
      { command: Boolean(req.body?.command) },
    );
    if (!sourceId) throw new RuntimeError('RUNTIME_QUERY_KEY_REQUIRED', 'کلید data-source الزامی است.', 422);
    const params = (req.body?.params && typeof req.body.params === 'object')
      ? req.body.params
      : (fixture?.params || {});
    const profile = profileFromEnvironment(
      target.environment,
      state.appOrigin || state.origin || target.origin,
      projectKey,
      state.authMode,
    );
    if (req.body?.serviceId || req.body?.projectServiceId) {
      profile.projectServiceId = String(req.body.serviceId || req.body.projectServiceId).trim();
    }
    if (!profile.projectServiceId) {
      throw new RuntimeError(
        'RUNTIME_SERVICE_ID_REQUIRED',
        'projectServiceId برای این پروژه تنظیم نشده است (مثلاً medu-community.medu.ir).',
        409,
      );
    }
    try {
      const result = await executeCoreOperation(
        state,
        profile,
        { sourceId, type: req.body?.command ? 'CORE_COMMAND' : 'CORE_QUERY' },
        params,
      );
      await setRuntimeSession(pool, req.user.id, target.environment.id, result.state, undefined, packKey || projectKey);
      const logical = result.response?.Result || {};
      res.json({
        ok: true,
        sourceId,
        serviceId: profile.projectServiceId,
        params,
        response: result.response,
        logical,
      });
    } catch (error) {
      throw mapRuntimeError(error);
    }
  }));
}

function registerRuntimeRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/runtime/origins', asyncRoute(async (req, res) => {
    const projectKey = String(req.query?.projectKey || '').trim() || null;
    const authMode = String(req.query?.authMode || '').trim() || null;
    const target = resolveAppTarget(projectKey, {
      authMode: authMode || undefined,
    });
    const preferred = projectKey
      ? (target.appOrigin || target.origin)
      : (configuredDefaultOrigins().includes('https://adib.m.edus.ir')
        ? 'https://adib.m.edus.ir'
        : (configuredDefaultOrigins()[0] || DEFAULT_RUNTIME_ORIGIN));
    const origins = candidateOriginsFromEnvironment(
      { gateway_base_url: null, base_url: preferred, api_base_url: null },
      projectKey,
      authMode || target.authMode,
    );
    res.json({
      origins: Array.from(new Set([...(origins || []), preferred].filter(Boolean))),
      defaultOrigin: preferred,
      authMode: target.authMode,
      authModes: target.authModes || [AUTH_MODE_DEVLOGIN],
      authOrigin: target.authOrigin,
      appOrigin: target.appOrigin,
      prostage: target.prostage,
      handoff: target.handoff,
      cookieScopes: target.cookieScopes,
      readyCheck: target.readyCheck,
      loginPath: target.loginPath,
      loginUrl: target.loginUrl,
      appPath: target.appPath,
      appUrl: target.appUrl,
      projectServiceId: target.projectServiceId || null,
      apiFixtures: target.apiFixtures || {},
      roleLandings: target.roleLandings,
      projectKey,
      userSource: process.env.RUNTIME_DEFAULT_USER_SOURCE || 'medugovir',
    });
  }));

  app.get('/api/runtime/app-targets/:projectKey', asyncRoute(async (req, res) => {
    const authMode = String(req.query?.authMode || '').trim() || null;
    res.json(resolveAppTarget(req.params.projectKey, { authMode: authMode || undefined }));
  }));

  registerSessionHandlers(app, { pool, audit }, {
    path: '/api/environments/:environmentId/runtime-session',
    async get(req, requestedOrigin, authMode = null) {
      const environment = await loadEnvironment(pool, ensureProjectAccess, req.user, req.params.environmentId);
      return {
        environment,
        origin: runtimeOriginOf(environment, requestedOrigin, null, authMode),
        projectKey: null,
        authMode: authMode || AUTH_MODE_DEVLOGIN,
      };
    },
  });

  registerSessionHandlers(app, { pool, audit }, {
    path: '/api/cde/projects/:projectKey/runtime-session',
    async get(req, requestedOrigin, authMode = null) {
      const mode = authMode || String(req.query?.authMode || req.body?.authMode || '').trim() || null;
      const resolved = await resolveWorkspaceMedusEnvironment(
        pool,
        req.user,
        req.params.projectKey,
        requestedOrigin || req.query?.origin,
        mode,
      );
      return {
        environment: resolved.environment,
        origin: resolved.origin,
        projectKey: resolved.projectKey,
        authMode: resolved.authMode,
      };
    },
  });
}

module.exports = {
  RuntimeError,
  registerRuntimeRoutes,
  profileFromEnvironment,
  runtimeOriginOf,
  configuredDefaultOrigins,
  candidateOriginsFromEnvironment,
  DEFAULT_RUNTIME_ORIGIN,
  MEDUS_ENV_NAME,
};

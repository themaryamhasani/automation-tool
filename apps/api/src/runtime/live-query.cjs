/**
 * Live get-data-source helper matching API-CONSOLE:
 * login uses host serviceId; app queries use projectServiceId (e.g. medu-community.medu.ir).
 */
const {
  executeCoreOperation,
  finishRuntimeLogin,
  normalizedProfile,
  postCore,
  startRuntimeLogin,
  RuntimeClientError,
} = require('./runtime-core-client.cjs');
const { cookieHeaderFromState } = require('../../../../shared/runtime/cookie-export.cjs');
const {
  resolveAppTarget,
  normalizeSourceId,
  getApiFixture,
} = require('../../../../shared/runtime/app-targets.cjs');

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function buildProfile(projectKey, overrides = {}) {
  const authMode = overrides.authMode || env('AUTOMATION_RUNTIME_AUTH_MODE') || undefined;
  const target = resolveAppTarget(projectKey, {
    origin: overrides.origin || env('AUTOMATION_RUNTIME_ORIGIN') || env('PREREG_BASE_URL') || undefined,
    projectServiceId: overrides.projectServiceId || env('AUTOMATION_PROJECT_SERVICE_ID') || undefined,
    appPath: overrides.appPath || env('AUTOMATION_RUNTIME_APP_PATH') || undefined,
    loginPath: overrides.loginPath || env('AUTOMATION_RUNTIME_LOGIN_PATH') || undefined,
    authMode,
  });
  if (!target.origin) throw new Error('RUNTIME_ORIGIN_REQUIRED');
  return normalizedProfile({
    id: `${projectKey || 'runtime'}-live`,
    origin: target.appOrigin || target.origin,
    authOrigin: target.authOrigin || target.origin,
    appOrigin: target.appOrigin || target.origin,
    projectServiceId: target.projectServiceId,
    loginPath: target.loginPath,
    coreBasePath: env('RUNTIME_DEFAULT_CORE_BASE_PATH') || '/core-api/v1',
    appRefererPath: target.appPath || '/',
    userSource: env('RUNTIME_DEFAULT_USER_SOURCE') || 'medugovir',
    authMode: target.authMode || authMode || 'devlogin',
    prostage: overrides.prostage || env('AUTOMATION_RUNTIME_PROSTAGE') || env('RUNTIME_PROSTAGE') || target.prostage || undefined,
    originAllowlist: target.originAllowlist,
    readyCheck: target.readyCheck,
  });
}

async function loginWithCredentials(projectKey, { phone, password, origin, projectServiceId } = {}) {
  const loginPhone = phone || env('RUNTIME_LOGIN_PHONE') || env('CAMP_LOGIN_PHONE') || env('COMMUNITY_LOGIN_PHONE');
  const loginPassword = password || env('RUNTIME_LOGIN_PASSWORD') || env('CAMP_LOGIN_PASSWORD') || env('COMMUNITY_LOGIN_PASSWORD');
  if (!loginPhone || !loginPassword) {
    return { ok: false, reason: 'no-credentials' };
  }
  const profile = buildProfile(projectKey, { origin, projectServiceId });
  const digits = String(loginPhone).replace(/\D/g, '').replace(/^0(?=9)/, '').replace(/^98(?=9)/, '');
  const started = await startRuntimeLogin(profile, digits);
  let state = started.state;
  if (!started.status?.connected) {
    const finished = await finishRuntimeLogin(state, profile, loginPassword);
    state = finished.state;
  }
  const header = await cookieHeaderFromState(state, profile.origin);
  if (header) {
    process.env.PREREG_COOKIE = header;
    process.env.AUTOMATION_RUNTIME_ORIGIN = profile.origin;
    process.env.AUTOMATION_PROJECT_SERVICE_ID = profile.projectServiceId || '';
    process.env.AUTOMATION_RUNTIME_APP_PATH = profile.appRefererPath;
    process.env.AUTOMATION_RUNTIME_LOGIN_PATH = profile.loginPath;
  }
  return { ok: true, state, profile, source: 'devlogin' };
}

async function queryDataSource(state, profile, sourceId, params = {}, options = {}) {
  const command = Boolean(options.command);
  const normalized = normalizeSourceId(sourceId, { command });
  if (!normalized) throw new RuntimeClientError('RUNTIME_BINDING_INVALID', 'sourceId / key is required.', 422);

  let nextProfile = profile;
  if (options.projectServiceId) {
    nextProfile = normalizedProfile({ ...profile, projectServiceId: options.projectServiceId });
  }
  if (!nextProfile.projectServiceId) {
    nextProfile = normalizedProfile({
      ...nextProfile,
      projectServiceId: nextProfile.runtimeServiceId,
    });
  }

  try {
    const result = await executeCoreOperation(
      state,
      nextProfile,
      { sourceId: normalized, type: command ? 'CORE_COMMAND' : 'CORE_QUERY' },
      params,
      options,
    );
    return {
      ok: true,
      state: result.state,
      profile: nextProfile,
      response: result.response,
      logical: result.response?.Result || {},
      sourceId: normalized,
      serviceId: nextProfile.projectServiceId,
    };
  } catch (error) {
    if (error instanceof RuntimeClientError && error.category === 'RUNTIME_BINDING_INVALID') {
      const key = String(sourceId || '').replace(/^\/+/, '').replace(/^ds\//, '').replace(/^fr\//, '');
      const payload = command
        ? { serviceId: nextProfile.projectServiceId, formId: key, data: params }
        : { serviceId: nextProfile.projectServiceId, key, params };
      const result = await postCore(state, nextProfile, command ? 'store-form-data' : 'get-data-source', payload, options);
      return {
        ok: true,
        state: result.state,
        profile: nextProfile,
        response: result.response,
        logical: result.response?.Result || {},
        sourceId: key,
        serviceId: nextProfile.projectServiceId,
      };
    }
    throw error;
  }
}

async function runFixture(projectKey, fixtureName, overrides = {}) {
  const fixture = getApiFixture(projectKey, fixtureName);
  if (!fixture) throw new Error(`Unknown fixture ${fixtureName} for ${projectKey}`);
  const login = await loginWithCredentials(projectKey, overrides);
  if (!login.ok) return { ok: false, reason: login.reason, fixture };
  const result = await queryDataSource(
    login.state,
    login.profile,
    fixture.sourceId,
    { ...fixture.params, ...(overrides.params || {}) },
    overrides,
  );
  return { ...result, fixture, loginSource: login.source };
}

function logicalServerError(logical) {
  const msg = logical?.serverMessage;
  if (!msg) {
    if (logical?.error && !logical?.done) return String(logical.error);
    return null;
  }
  if (msg.type === 'success') return null;
  if (msg.type === 'error') return String(msg.text || 'server error');
  if (/error|خطا/i.test(String(msg.text || '')) && !/موفق/i.test(String(msg.text || ''))) {
    return String(msg.text);
  }
  return null;
}

module.exports = {
  buildProfile,
  loginWithCredentials,
  queryDataSource,
  runFixture,
  logicalServerError,
};

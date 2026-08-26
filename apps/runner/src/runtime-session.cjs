const { cookieHeaderFromState, cookieHeadersForScopes } = require('../../../shared/runtime/cookie-export.cjs');
const { findConnectedRuntimeSession } = require('../../../shared/runtime/session-store.cjs');
const { resolveAppTarget, configuredOrigins } = require('../../../shared/runtime/app-targets.cjs');

function defaultRuntimeOrigin() {
  const configured = configuredOrigins();
  return configured[0] || 'https://soha.m.edus.ir';
}

function runtimeOriginOf(run, state) {
  const storedApp = String(state?.appOrigin || '').trim().replace(/\/$/, '');
  if (storedApp) return storedApp;
  const stored = String(state?.origin || '').trim().replace(/\/$/, '');
  if (stored) return stored;
  for (const candidate of [run.gateway_base_url, run.base_url, run.api_base_url]) {
    const value = String(candidate || '').trim().replace(/\/$/, '');
    if (value && /\.m\.edus\.ir/i.test(value)) return value;
  }
  const projectKey = run.cde_project_key || run.pack_id;
  if (projectKey) {
    const target = resolveAppTarget(projectKey, { authMode: state?.authMode || undefined });
    return target.appOrigin || target.origin;
  }
  return defaultRuntimeOrigin();
}

async function loadRuntimeSessionEnv(pool, run) {
  if (!run?.requested_by) return {};
  const projectKey = run.cde_project_key || run.pack_id || null;
  const state = await findConnectedRuntimeSession(pool, run.requested_by, {
    environmentId: run.environment_id,
    projectKey,
    packKey: projectKey,
  });
  if (!state || state.phase !== 'CONNECTED') return {};
  const origin = runtimeOriginOf(run, state);
  const authOrigin = String(state.authOrigin || origin).replace(/\/$/, '');
  const cookieHeader = await cookieHeaderFromState(state, origin);
  if (!cookieHeader) return {};
  const target = resolveAppTarget(projectKey, {
    origin,
    authMode: state.authMode || undefined,
  });
  const scopes = target.cookieScopes?.length ? target.cookieScopes : [authOrigin, origin];
  const scopedCookies = await cookieHeadersForScopes(state, scopes);
  return {
    PREREG_COOKIE: cookieHeader,
    PREREG_BASE_URL: origin,
    E2E_BASE_URL: origin,
    BASE_URL: origin,
    AUTOMATION_WEB_BASE_URL: run.base_url || origin,
    AUTOMATION_GATEWAY_BASE_URL: run.gateway_base_url || '',
    AUTOMATION_API_BASE_URL: run.api_base_url || '',
    AUTOMATION_RUNTIME_ORIGIN: origin,
    AUTOMATION_RUNTIME_AUTH_ORIGIN: authOrigin,
    AUTOMATION_RUNTIME_APP_ORIGIN: origin,
    AUTOMATION_RUNTIME_AUTH_MODE: state.authMode || target.authMode || 'devlogin',
    AUTOMATION_RUNTIME_PROSTAGE: state.prostage || target.prostage || '',
    AUTOMATION_RUNTIME_LOGIN_PATH: target.loginPath || '',
    AUTOMATION_RUNTIME_LOGIN_URL: target.loginUrl || '',
    AUTOMATION_RUNTIME_APP_PATH: target.appPath,
    AUTOMATION_RUNTIME_APP_URL: target.appUrl,
    AUTOMATION_PROJECT_SERVICE_ID: target.projectServiceId || '',
    AUTOMATION_CDE_PROJECT_KEY: projectKey || '',
    AUTOMATION_RUNTIME_COOKIE_SCOPES: JSON.stringify(scopedCookies),
  };
}

module.exports = { loadRuntimeSessionEnv, runtimeOriginOf, defaultRuntimeOrigin };

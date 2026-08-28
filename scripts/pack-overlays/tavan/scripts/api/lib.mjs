import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_KEY = 'tavan';

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
}

function liveQuery() {
  return require(path.join(repoRoot(), 'apps/api/src/runtime/live-query.cjs'));
}

function appTargets() {
  return require(path.join(repoRoot(), 'shared/runtime/app-targets.cjs'));
}

function clientModules() {
  const clientFile = path.join(repoRoot(), 'apps/api/src/runtime/runtime-core-client.cjs');
  if (!fs.existsSync(clientFile)) throw new Error(`runtime-client-missing: ${clientFile}`);
  return require(clientFile);
}

export function createReporter() {
  const rows = [];
  return {
    rows,
    pass(tc, title, detail = '') {
      rows.push({ tc, title, result: 'PASS', detail });
      console.log(`  ✓ PASS  ${tc} — ${title}${detail ? ` (${detail})` : ''}`);
    },
    fail(tc, title, detail = '') {
      rows.push({ tc, title, result: 'FAIL', detail });
      console.error(`  ✗ FAIL  ${tc} — ${title}${detail ? ` (${detail})` : ''}`);
    },
    skip(tc, title, detail = '') {
      rows.push({ tc, title, result: 'SKIP', detail });
      console.warn(`  ○ SKIP  ${tc} — ${title}${detail ? ` (${detail})` : ''}`);
    },
    summary() {
      const c = { PASS: 0, FAIL: 0, SKIP: 0 };
      for (const r of rows) c[r.result] = (c[r.result] || 0) + 1;
      console.log('\n=== SUMMARY ===');
      console.log(`PASS=${c.PASS}  FAIL=${c.FAIL}  SKIP=${c.SKIP}  TOTAL=${rows.length}`);
      return c;
    },
  };
}

export function expressUrl() {
  return (env('AUTOMATION_RUNTIME_URL') || '').replace(/\/$/, '');
}

export function liveOrigin() {
  const { resolveAppTarget } = appTargets();
  return (env('AUTOMATION_RUNTIME_ORIGIN') || env('TAVAN_LIVE_ORIGIN') || resolveAppTarget(PROJECT_KEY).origin).replace(/\/$/, '');
}

export function liveAppPath() {
  const { resolveAppTarget } = appTargets();
  return env('AUTOMATION_RUNTIME_APP_PATH') || env('TAVAN_APP_PATH') || resolveAppTarget(PROJECT_KEY).appPath;
}

export function liveAppUrl() {
  return env('AUTOMATION_RUNTIME_APP_URL') || `${liveOrigin()}${liveAppPath()}`;
}

export function appName() {
  return env('TAVAN_APP_NAME') || 'tavan';
}

export function projectServiceId() {
  const { resolveAppTarget } = appTargets();
  return env('AUTOMATION_PROJECT_SERVICE_ID') || resolveAppTarget(PROJECT_KEY, { origin: liveOrigin() }).projectServiceId;
}

export function coreBase() {
  return env('RUNTIME_DEFAULT_CORE_BASE_PATH') || '/core-api/v1';
}

export async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => ({}));
  return { res, body, status: res.status };
}

export async function liveGet(pathName, { timeoutMs = 45000 } = {}) {
  const url = `${liveOrigin()}${pathName.startsWith('/') ? pathName : `/${pathName}`}`;
  const headers = { accept: 'text/html,application/json' };
  const cookie = env('PREREG_COOKIE') || env('TAVAN_COOKIE');
  if (cookie) headers.cookie = cookie;
  try {
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (error) {
    return { status: 0, ok: false, text: '', error: error.message || String(error) };
  }
}

let session = null;

function liveCookieHeader() {
  return env('PREREG_COOKIE') || env('TAVAN_COOKIE');
}

function liveClientId() {
  return env('AUTOMATION_RUNTIME_CLIENT_ID') || env('RUNTIME_CLIENT_ID');
}

function liveProstage() {
  const explicit = env('AUTOMATION_RUNTIME_PROSTAGE') || env('RUNTIME_PROSTAGE');
  if (explicit) return explicit;
  try {
    if (/\.medu\.ir$/i.test(new URL(liveOrigin()).hostname)) return 'develop';
  } catch { /* ignore */ }
  return '';
}

function liveAuthMode() {
  const explicit = env('AUTOMATION_RUNTIME_AUTH_MODE');
  if (explicit) return explicit;
  try {
    if (/\.medu\.ir$/i.test(new URL(liveOrigin()).hostname)) return 'soha-gov-sso-handoff';
  } catch { /* ignore */ }
  return 'devlogin';
}

async function hydrateSessionFromEnvCookie() {
  const cookie = liveCookieHeader();
  if (!cookie) return null;
  const { createRuntimeState, normalizedProfile } = clientModules();
  const { importStorageStateIntoState } = require(path.join(repoRoot(), 'shared/runtime/cookie-export.cjs'));
  const { resolveAppTarget } = appTargets();
  const origin = liveOrigin();
  const authMode = liveAuthMode();
  const target = resolveAppTarget(PROJECT_KEY, { origin, authMode });
  const host = new URL(origin).hostname;
  const state = createRuntimeState('env-cookie');
  if (liveClientId()) state.clientId = liveClientId();
  state.phase = 'CONNECTED';
  state.origin = origin;
  state.appOrigin = origin;
  state.authOrigin = env('AUTOMATION_RUNTIME_AUTH_ORIGIN') || target.authOrigin || origin;
  state.authMode = authMode;
  state.prostage = liveProstage() || target.prostage || null;
  state.connectedAt = new Date().toISOString();
  await importStorageStateIntoState(state, {
    cookies: [{
      name: 'Cookie',
      value: cookie,
      domain: host,
      path: '/',
      secure: true,
      httpOnly: true,
    }],
  });
  const profile = normalizedProfile({
    id: 'env-cookie',
    origin,
    authOrigin: state.authOrigin,
    appOrigin: origin,
    runtimeServiceId: host,
    projectServiceId: projectServiceId() || host,
    loginPath: target.loginPath,
    coreBasePath: coreBase(),
    appRefererPath: liveAppPath() || target.appPath || '/',
    userSource: env('RUNTIME_DEFAULT_USER_SOURCE') || 'medugovir',
    authMode,
    prostage: state.prostage || undefined,
    originAllowlist: target.originAllowlist || ['*.medu.ir', '*.m.edus.ir'],
    readyCheck: target.readyCheck,
  });
  return { state, profile, source: 'env-cookie' };
}

export async function ensureLiveLogin() {
  if (session?.state?.phase === 'CONNECTED') {
    return { ok: true, source: 'memory', user: session.state.runtimeUser || null };
  }
  // Prefer injected runtime-session cookie (UI import / runner) over phone/password.
  if (liveCookieHeader()) {
    try {
      const hydrated = await hydrateSessionFromEnvCookie();
      if (hydrated?.state) {
        session = { state: hydrated.state, profile: hydrated.profile };
        return { ok: true, source: 'env-cookie', user: session.state.runtimeUser || null };
      }
    } catch (error) {
      return { ok: false, reason: `env-cookie-hydrate-failed: ${error.message || error}` };
    }
  }
  const { loginWithCredentials } = liveQuery();
  const login = await loginWithCredentials(PROJECT_KEY, {
    phone: env('TAVAN_LOGIN_PHONE') || env('RUNTIME_LOGIN_PHONE'),
    password: env('TAVAN_LOGIN_PASSWORD') || env('RUNTIME_LOGIN_PASSWORD'),
    origin: liveOrigin(),
    projectServiceId: projectServiceId(),
  });
  if (!login.ok) return login;
  session = { state: login.state, profile: login.profile };
  return { ok: true, source: login.source, user: login.state.runtimeUser || null };
}

function liveRequestHeaders(extra = {}) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json; charset=UTF-8',
    origin: liveOrigin(),
    referer: liveAppUrl(),
    ...extra,
  };
  const cookie = liveCookieHeader();
  if (cookie) headers.cookie = cookie;
  const clientId = liveClientId() || session?.state?.clientId;
  if (clientId) headers['client-id'] = clientId;
  const prostage = liveProstage() || session?.state?.prostage || session?.profile?.prostage;
  if (prostage) headers.prostage = String(prostage);
  return headers;
}

export async function postDataProvider(endpoint, params = {}, { withAuth = true, data, command } = {}) {
  const key = String(endpoint || '').replace(/^\/+/, '');
  const isCommand = command === true || key.startsWith('fr/') || data !== undefined;

  if (withAuth) {
    const login = await ensureLiveLogin();
    if (!login.ok) return { status: 0, ok: false, json: { error: login.reason }, text: login.reason, serverError: login.reason };
    if (session?.state) {
      if (isCommand) {
        const { postCore } = clientModules();
        const serviceId = projectServiceId() || session.profile.runtimeServiceId;
        const bare = key.replace(/^ds\//, '').replace(/^fr\//, '');
        const payload = { serviceId, formId: bare, data: data !== undefined ? data : params };
        const result = await postCore(session.state, session.profile, 'store-form-data', payload, {
          prostage: session.profile.prostage || liveProstage() || undefined,
        });
        session.state = result.state;
        const body = result.response;
        const logical = body?.Result || {};
        return {
          status: 200,
          ok: true,
          json: body,
          text: JSON.stringify(body),
          logical,
          serviceId,
          sourceId: key,
          serverError: logical?.serverMessage?.type === 'error' ? logical.serverMessage.text : null,
        };
      }
      const { queryDataSource, logicalServerError } = liveQuery();
      const sourceId = (key.startsWith('ds/') || key.startsWith('fr/') || key.startsWith('pages-app/') || key.startsWith('pwsp--') || key.startsWith('g/'))
        ? key
        : `ds/${key}`;
      try {
        // who-am-i on live medu uses host serviceId (same as browser / API-CONSOLE login surface).
        const whoAmI = /who-am-i/i.test(sourceId);
        const result = await queryDataSource(session.state, session.profile, sourceId, params, {
          projectServiceId: whoAmI
            ? (session.profile.runtimeServiceId || new URL(liveOrigin()).host)
            : projectServiceId(),
          prostage: session.profile.prostage || liveProstage() || undefined,
        });
        session.state = result.state;
        session.profile = result.profile;
        const serverError = logicalServerError(result.logical);
        return {
          status: 200,
          ok: !serverError,
          json: result.response,
          text: JSON.stringify(result.response),
          logical: result.logical,
          serviceId: result.serviceId,
          sourceId: result.sourceId,
          serverError,
        };
      } catch (error) {
        return {
          status: error.statusCode || 0,
          ok: false,
          json: { error: error.message },
          text: error.message,
          serverError: error.message,
        };
      }
    }
  }

  const url = `${liveOrigin()}${coreBase()}/data-provider/${isCommand ? 'store-form-data' : 'get-data-source'}`;
  const headers = liveRequestHeaders();
  const bare = key.replace(/^ds\//, '').replace(/^fr\//, '');
  const serviceId = (/who-am-i/i.test(bare)
    ? new URL(liveOrigin()).host
    : (projectServiceId() || new URL(liveOrigin()).host));
  const payload = isCommand
    ? { serviceId, formId: bare, data: data !== undefined ? data : params }
    : { serviceId, key: bare, params };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok, json, text, logical: json?.Result || null, serviceId };
}

export async function runNamedFixture(name, paramsOverride = {}) {
  const { getApiFixture } = appTargets();
  const fixture = getApiFixture(PROJECT_KEY, name);
  if (!fixture) throw new Error(`fixture-missing:${name}`);
  return postDataProvider(fixture.sourceId, { ...fixture.params, ...paramsOverride });
}

export function pickOrganPath(rolesPayload) {
  const root = rolesPayload?.Result || rolesPayload?.logical || rolesPayload || {};
  const provider = root['data-provider'] || root.data || root;
  const list = provider?.roleDetail || provider?.roles || root.roleDetail || [];
  if (Array.isArray(list) && list.length) {
    const admin = list.find(r => String(r.branch || '').includes('roles.admin')) || list[0];
    const fromRoles = admin?.or_path?.[0] || admin?.or_m_path || admin?.path || '';
    if (fromRoles) return String(fromRoles).trim();
  }
  // ds/tavan/app/load shape
  const paths = provider?.userOragnPath || root.userOragnPath || [];
  if (Array.isArray(paths) && paths[0]) return String(paths[0]).trim();
  if (provider?.userAccessOrgan) return String(provider.userAccessOrgan).trim();
  if (typeof paths === 'string' && paths) return paths.trim();
  return '';
}

/**
 * app.load does NOT return course/implement ids — only organs + role flags.
 * Course id must come from env/pack (e.g. URL …/sessions-list/CC05110111PL1IM1).
 */
export function pickCourseId(appLoadPayload) {
  const fromEnv = env('TAVAN_COURSE_ID') || env('AUTOMATION_TAVAN_COURSE_ID');
  if (fromEnv) return fromEnv;
  const { resolveAppTarget } = appTargets();
  const preferred = resolveAppTarget(PROJECT_KEY)?.preferredCourseId
    || resolveAppTarget(PROJECT_KEY)?.apiFixtures?.['bank.quizzes.list']?.params?.course_id;
  if (preferred) return String(preferred).trim();

  const root = appLoadPayload?.Result || appLoadPayload?.logical || appLoadPayload || {};
  const provider = root['data-provider'] || root.data || root;
  const pools = [
    provider?.courses,
    provider?.implements,
    provider?.implementList,
    provider?.myCourses,
    provider?.List,
    root.courses,
    root.implements,
  ];
  for (const list of pools) {
    if (!Array.isArray(list) || !list.length) continue;
    const hit = list.find((row) => row?.rand_id || row?.course_id || row?.id || row?.imple_rand_id);
    if (!hit) continue;
    return String(hit.rand_id || hit.course_id || hit.imple_rand_id || hit.id || '').trim();
  }
  return '';
}

export function resolveTavanContext(appLoadPayload) {
  const { resolveAppTarget } = appTargets();
  const target = resolveAppTarget(PROJECT_KEY) || {};
  const organFromEnv = env('TAVAN_ORGAN_PATH') || env('AUTOMATION_TAVAN_ORGAN_PATH');
  const organPath = organFromEnv
    || pickOrganPath(appLoadPayload)
    || String(target.preferredOrganPath || '').trim()
    || 'IR2O2';
  const courseId = pickCourseId(appLoadPayload);
  const role = env('TAVAN_ROLE') || 'emis:fragier';
  return { organPath, courseId, role };
}

export function isAuthDenied(res) {
  const logical = res.logical || res.json?.Result || {};
  if (logical.IsUserLogin === false || logical.IsLogin === false) return true;
  const blob = JSON.stringify(res.json || {});
  return res.status === 401 || /شناسایی کاربر|unauthorized|لاگین|کاربر معتبر نیست/i.test(blob);
}

export function isModuleGap(res) {
  return /request apiModule error|module not found|apiModule error/i.test(String(res?.serverError || ''))
    || /request apiModule error/i.test(JSON.stringify(res?.json || {}));
}

/** Treat missing modules as FAIL (not SKIP) so runs never look green while empty. */
export function assertModuleReady(r, tc, title, res) {
  if (isModuleGap(res)) {
    r.fail(tc, title, `apiModule missing: ${res.serverError || JSON.stringify(res.json).slice(0, 180)}`);
    return false;
  }
  return true;
}

export function loadCatalog() {
  const file = path.join(__dirname, '..', '..', 'data', 'catalog.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}


import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_KEY = 'medu-camp';

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
  return (env('AUTOMATION_RUNTIME_ORIGIN') || env('CAMP_LIVE_ORIGIN') || resolveAppTarget(PROJECT_KEY).origin).replace(/\/$/, '');
}

export function liveAppPath() {
  const { resolveAppTarget } = appTargets();
  return env('AUTOMATION_RUNTIME_APP_PATH') || env('CAMP_APP_PATH') || resolveAppTarget(PROJECT_KEY).appPath;
}

export function liveAppUrl() {
  return env('AUTOMATION_RUNTIME_APP_URL') || `${liveOrigin()}${liveAppPath()}`;
}

export function liveLoginPath() {
  return env('AUTOMATION_RUNTIME_LOGIN_PATH') || env('RUNTIME_DEFAULT_LOGIN_PATH') || '/devlogin';
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
  const cookie = env('PREREG_COOKIE') || env('CAMP_COOKIE');
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

export async function ensureLiveLogin() {
  if (session?.state?.phase === 'CONNECTED') {
    return { ok: true, source: 'memory', user: session.state.runtimeUser || null };
  }
  const { loginWithCredentials } = liveQuery();
  const login = await loginWithCredentials(PROJECT_KEY, {
    phone: env('CAMP_LOGIN_PHONE') || env('RUNTIME_LOGIN_PHONE'),
    password: env('CAMP_LOGIN_PASSWORD') || env('RUNTIME_LOGIN_PASSWORD'),
    origin: liveOrigin(),
    projectServiceId: projectServiceId(),
  });
  if (!login.ok) {
    if (env('PREREG_COOKIE') || env('CAMP_COOKIE')) return { ok: true, source: 'env-cookie' };
    return login;
  }
  session = { state: login.state, profile: login.profile };
  return { ok: true, source: login.source, user: login.state.runtimeUser || null };
}

/** API-CONSOLE get-data-source / store-form-data with camp serviceId (= origin host on adib). */
export async function postDataProvider(endpoint, params = {}, { withAuth = true, data, command } = {}) {
  const key = String(endpoint || '').replace(/^\/+/, '');
  const isCommand = command === true || key.startsWith('fr/') || data !== undefined;

  if (withAuth) {
    const login = await ensureLiveLogin();
    if (!login.ok) return { status: 0, ok: false, json: { error: login.reason }, text: login.reason };
    if (session?.state) {
      if (isCommand) {
        const { postCore } = clientModules();
        const serviceId = projectServiceId() || session.profile.runtimeServiceId;
        const bare = key.replace(/^ds\//, '').replace(/^fr\//, '');
        const payload = { serviceId, formId: bare, data: data !== undefined ? data : params };
        const result = await postCore(session.state, session.profile, 'store-form-data', payload);
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
      const sourceId = key.startsWith('ds/') || key.startsWith('fr/') ? key : `ds/${key}`;
      try {
        const result = await queryDataSource(session.state, session.profile, sourceId, params, {
          projectServiceId: projectServiceId(),
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
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json; charset=UTF-8',
    origin: liveOrigin(),
    referer: liveAppUrl(),
  };
  const bare = key.replace(/^ds\//, '').replace(/^fr\//, '');
  const serviceId = projectServiceId() || new URL(liveOrigin()).host;
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
  if (!Array.isArray(list) || !list.length) return '';
  const school = list.find(r => String(r.branch || '').includes('roles.admin')) || list[0];
  return school?.or_path?.[0] || school?.or_m_path || '';
}

export function pickRole(rolesPayload, needle) {
  const root = rolesPayload?.Result || rolesPayload?.logical || rolesPayload || {};
  const list = root.roleDetail || root['data-provider']?.roleDetail || [];
  if (!Array.isArray(list)) return null;
  return list.find(r => String(r.branch || '').includes(needle)) || null;
}

export function countStatus(statusCountsLogical, status) {
  const rows = statusCountsLogical?.res || [];
  const hit = rows.find(r => Number(r.status) === Number(status));
  return hit ? Number(hit.count) : 0;
}

export async function createCamp({ organPath, pk_rand_id, meta }) {
  const stamp = `qa-${Date.now().toString(36)}`;
  return postDataProvider('fr/medu-camp/camp', {}, {
    data: {
      organPath,
      pk_rand_id: pk_rand_id || stamp,
      meta: meta || { type: 'inSchool', title: `QA ${stamp}`, source: 'automation-tool' },
    },
  });
}

export function isAuthDenied(res) {
  const logical = res.logical || res.json?.Result || {};
  if (logical.IsUserLogin === false || logical.IsLogin === false) return true;
  const blob = JSON.stringify(res.json || {});
  return res.status === 401 || /شناسایی کاربر|unauthorized|لاگین/i.test(blob);
}

export function isModuleGap(res) {
  return /request apiModule error/i.test(String(res?.serverError || ''))
    || /request apiModule error/i.test(JSON.stringify(res?.json || {}));
}

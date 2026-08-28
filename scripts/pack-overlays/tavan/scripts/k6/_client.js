/**
 * Shared k6 client for tavan — mirrors live browser data-provider calls.
 *
 * Live shape (tavan.medu.ir DevTools):
 *   POST {origin}/core-api/v1/data-provider/get-data-source
 *   Cookie / Client-Id / prostage / Origin / Referer / Content-Type
 *
 * Auth cookie comes from Runtime Login → runner injects PREREG_COOKIE.
 * Does NOT perform MyMedu / SSO / devlogin inside the script.
 */
import http from 'k6/http';
import { check } from 'k6';

export function env(name, fallback = '') {
  return String(__ENV[name] ?? fallback).trim();
}

function isMeduOrigin(origin) {
  try {
    return /\.medu\.ir$/i.test(new URL(String(origin || '')).hostname);
  } catch {
    return false;
  }
}

/** Local CDE express runtime produced by this automation tool. */
export function expressBase() {
  return env('AUTOMATION_RUNTIME_URL', 'http://127.0.0.1:4520').replace(/\/$/, '');
}

/** Live app origin (cookie-scoped). Prefer app origin from runtime session. */
export function liveOrigin() {
  return env(
    'AUTOMATION_RUNTIME_APP_ORIGIN',
    env('AUTOMATION_RUNTIME_ORIGIN', env('PREREG_BASE_URL', 'https://tavan.medu.ir')),
  ).replace(/\/$/, '');
}

/** /landing on *.medu.ir (stage), /tavan on *.m.edus.ir (CI). */
export function liveAppPath() {
  const explicit = env('AUTOMATION_RUNTIME_APP_PATH', '');
  if (explicit) return explicit;
  return isMeduOrigin(liveOrigin()) ? '/landing' : '/tavan';
}

export function coreBase() {
  return env('RUNTIME_DEFAULT_CORE_BASE_PATH', '/core-api/v1');
}

export function serviceId() {
  return env('AUTOMATION_PROJECT_SERVICE_ID', 'tavan.medu.ir');
}

export function courseId() {
  return env('TAVAN_COURSE_ID', env('AUTOMATION_TAVAN_COURSE_ID', 'CC05110111PL1IM1'));
}

export function organPath() {
  return env('TAVAN_ORGAN_PATH', env('AUTOMATION_TAVAN_ORGAN_PATH', 'IR2O2'));
}

export function runtimeClientId() {
  return env('AUTOMATION_RUNTIME_CLIENT_ID', env('RUNTIME_CLIENT_ID', ''));
}

export function runtimeProstage() {
  const explicit = env('AUTOMATION_RUNTIME_PROSTAGE', '');
  if (explicit) return explicit;
  return isMeduOrigin(liveOrigin()) ? 'develop' : '';
}

/** Cookie header value — same role as browser Cookie on get-data-source. */
export function runtimeCookie() {
  const direct = env('PREREG_COOKIE', env('TAVAN_COOKIE', ''));
  if (direct) return direct;
  try {
    const scopes = JSON.parse(env('AUTOMATION_RUNTIME_COOKIE_SCOPES', '{}') || '{}');
    const origin = liveOrigin();
    return String(scopes[origin] || scopes[`${origin}/`] || '').trim();
  } catch {
    return '';
  }
}

export function hasRuntimeAuth() {
  return Boolean(runtimeCookie());
}

/**
 * Headers aligned with live tavan.medu.ir request.
 * Cookie is the session; Client-Id + prostage match API-CONSOLE / stage gateway.
 */
export function liveHeaders(extra = {}) {
  const origin = liveOrigin();
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json',
    Origin: origin,
    Referer: `${origin}${liveAppPath()}`,
  };
  const cookie = runtimeCookie();
  if (cookie) headers.Cookie = cookie;
  const clientId = runtimeClientId();
  if (clientId) headers['Client-Id'] = clientId;
  const prostage = runtimeProstage();
  if (prostage) headers.prostage = prostage;
  return { ...headers, ...extra };
}

function bareKey(sourceId) {
  return String(sourceId || '').replace(/^ds\//, '').replace(/^fr\//, '');
}

function dpUrl(endpoint) {
  return `${liveOrigin()}${coreBase()}/data-provider/${endpoint}`;
}

/** GET-style data-provider (ds/…). */
export function dpGet(sourceId, params = {}, tags = {}) {
  const body = JSON.stringify({
    serviceId: serviceId(),
    key: bareKey(sourceId),
    params,
  });
  return http.post(dpUrl('get-data-source'), body, {
    headers: liveHeaders(),
    tags: { name: bareKey(sourceId), ...tags },
  });
}

/** Command / form store (fr/…). */
export function dpCmd(formId, data = {}, tags = {}) {
  const body = JSON.stringify({
    serviceId: serviceId(),
    formId: bareKey(formId),
    data,
  });
  return http.post(dpUrl('store-form-data'), body, {
    headers: liveHeaders(),
    tags: { name: bareKey(formId), ...tags },
  });
}

export function statusOk(res) {
  return res && res.status > 0 && res.status < 500;
}

export function jsonBody(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

export function logicalResult(res) {
  const body = jsonBody(res);
  return body?.Result || body || null;
}

export function requireRuntimeAuth(checks = {}) {
  const ok = hasRuntimeAuth();
  check(null, { 'runtime Cookie present (PREREG_COOKIE)': () => ok, ...checks });
  return ok;
}

/** Pressure on this tool's CDE express pack (structure), not MyMedu login. */
export function hitExpressStructure(packIds = []) {
  const base = expressBase();
  const health = http.get(`${base}/health`, { tags: { name: 'express.health' } });
  check(health, { 'express /health 200': (r) => r.status === 200 });

  const catalog = http.get(`${base}/__runtime/catalog`, { tags: { name: 'express.catalog' } });
  check(catalog, { 'express catalog ok': (r) => r.status === 200 });

  const manifest = http.get(`${base}/__runtime/manifest`, { tags: { name: 'express.manifest' } });
  check(manifest, { 'express manifest ok': (r) => r.status === 200 });

  for (const packId of packIds) {
    const url = `${base}/__runtime/api-module?packId=${encodeURIComponent(packId)}`;
    const res = http.get(url, { tags: { name: `express.api:${packId}` } });
    check(res, { [`express api-module ${packId}`]: (r) => r.status === 200 || r.status === 404 });
  }
}

export const BUSINESS_PACK_IDS = [
  'ds/tavan/app/load',
  'ds/tavan/bank/folder/load',
  'ds/tavan/bank/sessions/list',
  'ds/tavan/bank/quizzes/list',
  'ds/tavan/classroom/announcements-section-load',
];

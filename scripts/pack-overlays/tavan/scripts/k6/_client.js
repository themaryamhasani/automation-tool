/**
 * Shared k6 client for tavan CDE packs.
 * Auth: uses runtime session cookie already injected by the runner (PREREG_COOKIE).
 * Does NOT perform MyMedu / SSO / devlogin — those belong outside load scripts.
 */
import http from 'k6/http';
import { check } from 'k6';

export function env(name, fallback = '') {
  return String(__ENV[name] ?? fallback).trim();
}

/** Local CDE express runtime produced by this automation tool. */
export function expressBase() {
  return env('AUTOMATION_RUNTIME_URL', env('BASE_URL', 'http://127.0.0.1:4520')).replace(/\/$/, '');
}

/** Live app origin used for data-provider calls (cookie scoped there by runtime session). */
export function liveOrigin() {
  return env(
    'AUTOMATION_RUNTIME_ORIGIN',
    env('AUTOMATION_RUNTIME_APP_ORIGIN', env('PREREG_BASE_URL', 'https://soha.m.edus.ir')),
  ).replace(/\/$/, '');
}

export function liveAppPath() {
  return env('AUTOMATION_RUNTIME_APP_PATH', '/tavan') || '/tavan';
}

export function coreBase() {
  return env('RUNTIME_DEFAULT_CORE_BASE_PATH', '/core-api/v1');
}

export function serviceId() {
  return env('AUTOMATION_PROJECT_SERVICE_ID', 'tavan.medu.ir');
}

/** Course / organ from pack defaults or runner env — not discovered via login. */
export function courseId() {
  return env('TAVAN_COURSE_ID', env('AUTOMATION_TAVAN_COURSE_ID', 'CC05110111PL1IM1'));
}

export function organPath() {
  return env('TAVAN_ORGAN_PATH', env('AUTOMATION_TAVAN_ORGAN_PATH', 'IR2O2'));
}

export function runtimeCookie() {
  return env('PREREG_COOKIE', env('TAVAN_COOKIE', ''));
}

export function hasRuntimeAuth() {
  return Boolean(runtimeCookie());
}

export function liveHeaders(extra = {}) {
  const headers = {
    'content-type': 'application/json; charset=UTF-8',
    accept: 'application/json',
    origin: liveOrigin(),
    referer: `${liveOrigin()}${liveAppPath()}`,
    ...extra,
  };
  const cookie = runtimeCookie();
  if (cookie) headers.cookie = cookie;
  return headers;
}

function bareKey(sourceId) {
  return String(sourceId || '').replace(/^ds\//, '').replace(/^fr\//, '');
}

/** GET-style data-provider (ds/…). */
export function dpGet(sourceId, params = {}, tags = {}) {
  const url = `${liveOrigin()}${coreBase()}/data-provider/get-data-source`;
  const body = JSON.stringify({
    serviceId: serviceId(),
    key: bareKey(sourceId),
    params,
  });
  return http.post(url, body, { headers: liveHeaders(), tags: { name: bareKey(sourceId), ...tags } });
}

/** Command / form store (fr/…). */
export function dpCmd(formId, data = {}, tags = {}) {
  const url = `${liveOrigin()}${coreBase()}/data-provider/store-form-data`;
  const body = JSON.stringify({
    serviceId: serviceId(),
    formId: bareKey(formId),
    data,
  });
  return http.post(url, body, { headers: liveHeaders(), tags: { name: bareKey(formId), ...tags } });
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
  check(null, { 'runtime cookie present (PREREG_COOKIE)': () => ok, ...checks });
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

const { randomBytes } = require('node:crypto');
const CryptoJS = require('crypto-js');
const { CookieJar } = require('tough-cookie');

const CDE_ORIGIN = process.env.CDE_ORIGIN || 'https://cde.edus.ir';
const SERVICE_ID = 'cde.edus.ir';
const DATA_SOURCE_URL = `${CDE_ORIGIN}/core-api/v1/data-provider/get-data-source`;
const STORE_FORM_URL = `${CDE_ORIGIN}/core-api/v1/data-provider/store-form-data`;
const MAX_BODY_BYTES = Number(process.env.CDE_MAX_BODY_BYTES || 32 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = Number(process.env.CDE_REQUEST_TIMEOUT_MS || 60_000);

const ALLOWED_DATA_KEYS = new Set([
  'pages-app/who-am-i',
  'cde/repository/list/my-repo',
  'cde/repository/web-ui/list/fetch',
  'cde/repository/data-service/list/fetch',
  'cde/repository/api-module/list/fetch',
  'cde/repository/message-consumer/list/fetch',
  'cde/package/any/one/fetch',
]);
const ALLOWED_FORM_IDS = new Set(['auth/signin/iran-cellphone', 'auth/signin/check-password']);

class CoreClientError extends Error {
  constructor(category, message, statusCode = 502, details) {
    super(message);
    this.code = category;
    this.status = statusCode;
    this.details = details;
  }
}

function randomSegment() {
  return randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8).padEnd(8, '0');
}
function createClientId() {
  return [Date.now().toString(36), randomSegment(), randomSegment(), randomSegment(), randomSegment()].join('-');
}
function createCdeState() {
  return { clientId: createClientId(), cookieJar: new CookieJar().serializeSync(), ecreq: false, connectedAt: new Date().toISOString() };
}
function secretForClientId(clientId) { return String(clientId || '').split('-').sort().join('%'); }
function encryptRequest(payload, clientId) { return CryptoJS.AES.encrypt(JSON.stringify(payload), secretForClientId(clientId)).toString(); }
function decryptResponse(token, clientId) {
  const plaintext = CryptoJS.AES.decrypt(String(token), secretForClientId(clientId)).toString(CryptoJS.enc.Utf8);
  if (!plaintext) throw new CoreClientError('CDE_DECRYPTION_FAILED', 'پاسخ رمزگذاری‌شده CDE قابل رمزگشایی نبود.');
  let value;
  try {
    value = JSON.parse(plaintext);
    if (typeof value === 'string') value = JSON.parse(value);
  } catch { throw new CoreClientError('CDE_INVALID_JSON', 'پاسخ رمزگشایی‌شده CDE معتبر نبود.'); }
  return { Result: value };
}
function stripProviderPrefix(value, prefix) { return String(value || '').replace(new RegExp(`^${prefix}/`), ''); }
function setCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  return combined ? combined.split(/,(?=\s*[^;,]+=)/g) : [];
}
function responseLogicalError(response) {
  const result = response?.Result;
  if (!response || typeof response !== 'object') return 'پاسخ CDE یک شیء JSON نبود.';
  if (response.error) return String(response.error);
  if (result?.error) return typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
  if (result?.success === false) return String(result.message || 'عملیات CDE ناموفق بود.');
  if (['error', 'danger'].includes(result?.serverMessage?.type)) return String(result.serverMessage.text || 'عملیات CDE ناموفق بود.');
  return null;
}
function assertLogicalSuccess(response) {
  const logicalError = responseLogicalError(response);
  if (logicalError) throw new CoreClientError('CDE_LOGICAL_ERROR', logicalError, 502);
  return response;
}
async function readBoundedJson(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new CoreClientError('CDE_RESPONSE_TOO_LARGE', 'حجم پاسخ CDE از حد مجاز بیشتر است.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) throw new CoreClientError('CDE_RESPONSE_TOO_LARGE', 'حجم پاسخ CDE از حد مجاز بیشتر است.');
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new CoreClientError('CDE_INVALID_JSON', 'CDE پاسخ JSON معتبر برنگرداند.'); }
}
async function postCore(state, url, payload, options = {}) {
  if (!state?.clientId || !state?.cookieJar) throw new CoreClientError('CDE_SESSION_INVALID', 'نشست CDE معتبر نیست.', 401);
  const jar = CookieJar.deserializeSync(state.cookieJar);
  const outbound = state.ecreq === true ? { reqtoken: encryptRequest(payload, state.clientId) } : payload;
  const serialized = JSON.stringify(outbound);
  if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) throw new CoreClientError('CDE_REQUEST_TOO_LARGE', 'حجم درخواست CDE از حد مجاز بیشتر است.', 413);
  const headers = {
    accept: '*/*', 'content-type': 'application/json; charset=UTF-8', 'client-id': state.clientId,
    origin: CDE_ORIGIN, referer: options.editor ? `${CDE_ORIGIN}/second-editor` : `${CDE_ORIGIN}/`,
  };
  const cookie = await jar.getCookieString(url);
  if (cookie) headers.cookie = cookie;
  if (options.prostage) headers.prostage = String(options.prostage);
  let response;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, { method: 'POST', headers, body: serialized, redirect: 'manual', signal: controller.signal });
      lastError = null;
      break;
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      lastError = new CoreClientError(
        timedOut ? 'CDE_TIMEOUT' : 'CDE_UNAVAILABLE',
        timedOut ? 'پاسخ CDE بیش از حد طول کشید.' : 'سرویس CDE در دسترس نیست. دوباره تلاش کنید.',
        timedOut ? 504 : 502,
      );
      if (timedOut || attempt === 1) throw lastError;
      await new Promise(resolve => setTimeout(resolve, 400));
    } finally { clearTimeout(timeout); }
  }
  if (!response) throw lastError;
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location || new URL(location, CDE_ORIGIN).origin !== CDE_ORIGIN) throw new CoreClientError('CDE_REDIRECT_REJECTED', 'تغییر مسیر ناامن CDE رد شد.');
    throw new CoreClientError('CDE_REDIRECT_REJECTED', 'تغییر مسیر غیرمنتظره CDE رد شد.');
  }
  if (!response.ok) throw new CoreClientError('CDE_HTTP_ERROR', `CDE خطای HTTP ${response.status} برگرداند.`, 502);
  for (const value of setCookieValues(response.headers)) await jar.setCookie(value, url, { ignoreError: true });
  let parsed = await readBoundedJson(response);
  if (parsed?.token) parsed = decryptResponse(parsed.token, state.clientId);
  state.cookieJar = jar.serializeSync();
  if (typeof parsed?.Result?.ecreq === 'boolean') state.ecreq = parsed.Result.ecreq;
  state.lastUsedAt = new Date().toISOString();
  return { response: parsed, state };
}
async function getDataSource(state, provider, params = {}, options = {}) {
  const key = stripProviderPrefix(provider, 'ds');
  if (!ALLOWED_DATA_KEYS.has(key)) throw new CoreClientError('CDE_PROVIDER_NOT_ALLOWED', 'Data Provider در فهرست مجاز نیست.', 403);
  return postCore(state, DATA_SOURCE_URL, { serviceId: SERVICE_ID, key, params: params || {} }, { editor: key.startsWith('cde/'), ...options });
}
async function storeFormData(state, provider, data = {}, options = {}) {
  const formId = stripProviderPrefix(provider, 'fr');
  if (!ALLOWED_FORM_IDS.has(formId)) throw new CoreClientError('CDE_PROVIDER_NOT_ALLOWED', 'Form Provider در فهرست مجاز نیست.', 403);
  return postCore(state, STORE_FORM_URL, { serviceId: SERVICE_ID, formId, data: data || {} }, { editor: formId.startsWith('cde/'), prostage: formId.startsWith('cde/') ? 'develop' : undefined, ...options });
}

module.exports = { CDE_ORIGIN, SERVICE_ID, CoreClientError, assertLogicalSuccess, createCdeState, getDataSource, storeFormData };

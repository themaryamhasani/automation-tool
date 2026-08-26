const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const { randomBytes } = require('crypto');
const CryptoJS = require('crypto-js');
const { CookieJar } = require('tough-cookie');

const DEFAULT_CORE_BASE_PATH = '/core-api/v1';
const DEFAULT_LOGIN_PATH = '/devlogin';
const DEFAULT_USER_SOURCE = 'medugovir';
const MAX_BODY_BYTES = Number(process.env.RUNTIME_MAX_BODY_BYTES || 32 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = Number(process.env.RUNTIME_REQUEST_TIMEOUT_MS || 60_000);

class RuntimeClientError extends Error {
  constructor(category, message, statusCode = 400, details) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function randomSegment() {
  return randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8).padEnd(8, '0');
}

function createClientId() {
  return [Date.now().toString(36), randomSegment(), randomSegment(), randomSegment(), randomSegment()].join('-');
}

function createRuntimeState(profileId) {
  return {
    profileId: String(profileId),
    clientId: createClientId(),
    cookieJar: new CookieJar().serializeSync(),
    ecreq: false,
    phase: 'STARTING',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
}

function normalizePath(value, fallback) {
  const text = String(value || fallback || '').trim();
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\') || text.includes('\0')) {
    throw new RuntimeClientError('RUNTIME_PROFILE_INVALID', 'Runtime paths must be absolute same-origin paths.', 422);
  }
  const parsed = new URL(text, 'https://runtime.invalid');
  if (parsed.origin !== 'https://runtime.invalid') {
    throw new RuntimeClientError('RUNTIME_PROFILE_INVALID', 'Runtime paths must stay on the configured origin.', 422);
  }
  return `${parsed.pathname}${parsed.search}`;
}

function originAllowlist(extra = []) {
  const fromEnv = String(process.env.RUNTIME_ORIGIN_ALLOWLIST || '*.m.edus.ir')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const fromExtra = (Array.isArray(extra) ? extra : [extra])
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...fromEnv, ...fromExtra]));
}

function hostMatchesRule(hostname, rule) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const expected = String(rule || '').toLowerCase().replace(/\.$/, '');
  if (expected.startsWith('*.')) {
    const suffix = expected.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === expected;
}

function hostAllowed(hostname, allowlist) {
  return (allowlist || originAllowlist()).some(rule => hostMatchesRule(hostname, rule));
}

/** Hosts that may resolve to RFC1918 on corp/stage networks (never raw IP origins). */
function intranetOriginAllowlist(extra = []) {
  const fromEnv = String(process.env.RUNTIME_INTRANET_ORIGIN_ALLOWLIST || '*.medu.ir')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const fromExtra = (Array.isArray(extra) ? extra : [extra])
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...fromEnv, ...fromExtra]));
}

function hostAllowsIntranetResolution(hostname, options = {}) {
  if (options.allowIntranetResolution === false) return false;
  if (options.allowIntranetResolution === true) return true;
  const rules = intranetOriginAllowlist(options.intranetAllowlist || []);
  return rules.some(rule => hostMatchesRule(hostname, rule));
}

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateIp(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  const version = net.isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7));
  return false;
}

/** Still blocked for intranet-allowlisted hostnames (loopback / link-local / metadata-ish). */
function isUnsafeEvenForIntranet(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  const version = net.isIP(normalized);
  if (version === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
  }
  if (version !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80')) return true;
  if (normalized.startsWith('::ffff:')) return isUnsafeEvenForIntranet(normalized.slice(7));
  return false;
}

function addressBlockedForOrigin(address, { allowIntranet = false } = {}) {
  if (allowIntranet) return isUnsafeEvenForIntranet(address);
  return isPrivateIp(address);
}

function parseRuntimeOrigin(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new RuntimeClientError('RUNTIME_ORIGIN_INVALID', 'Runtime origin must be a valid HTTPS origin.', 422);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new RuntimeClientError('RUNTIME_ORIGIN_INVALID', 'Runtime origin must be an exact HTTPS origin without credentials, path, query, or fragment.', 422);
  }
  const origin = parsed.origin;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const allowlist = originAllowlist(options.allowlist || options.originAllowlist || []);
  if (!hostAllowed(hostname, allowlist)) {
    throw new RuntimeClientError('RUNTIME_ORIGIN_NOT_ALLOWED', 'Runtime origin is not included in RUNTIME_ORIGIN_ALLOWLIST.', 403);
  }
  return { origin, hostname, host: parsed.host, allowlist };
}

async function validateRuntimeOrigin(value, options = {}) {
  const parsed = parseRuntimeOrigin(value, options);
  // Literal IP origins stay strict — never treat raw https://10.x.x.x as safe.
  if (net.isIP(parsed.hostname)) {
    if (isPrivateIp(parsed.hostname)) {
      throw new RuntimeClientError('RUNTIME_SSRF_BLOCKED', 'Runtime origin resolves to a private or reserved address.', 403);
    }
    return { ...parsed, addresses: [parsed.hostname] };
  }
  let records;
  try {
    records = await (options.lookup || dns.lookup)(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new RuntimeClientError('RUNTIME_DNS_FAILED', 'Runtime origin could not be resolved.', 422);
  }
  const addresses = Array.from(new Set((Array.isArray(records) ? records : [records]).map(record => record?.address).filter(Boolean)));
  const allowIntranet = hostAllowsIntranetResolution(parsed.hostname, options);
  if (!addresses.length || addresses.some(address => addressBlockedForOrigin(address, { allowIntranet }))) {
    throw new RuntimeClientError('RUNTIME_SSRF_BLOCKED', 'Runtime origin resolves to a private, reserved, or invalid address.', 403);
  }
  return { ...parsed, addresses, allowIntranet };
}

function normalizedProfile(profile) {
  const allowlist = profile?.originAllowlist || profile?.allowlist || [];
  const parsed = parseRuntimeOrigin(profile?.origin, { allowlist });
  const loginPathRaw = profile?.loginPath;
  return {
    ...profile,
    origin: parsed.origin,
    runtimeServiceId: String(profile?.runtimeServiceId || parsed.host),
    coreBasePath: normalizePath(profile?.coreBasePath, DEFAULT_CORE_BASE_PATH).replace(/\/$/, ''),
    loginPath: loginPathRaw == null || loginPathRaw === ''
      ? null
      : normalizePath(loginPathRaw, DEFAULT_LOGIN_PATH),
    appRefererPath: normalizePath(profile?.appRefererPath, '/'),
    userSource: String(profile?.userSource || DEFAULT_USER_SOURCE),
    authMode: String(profile?.authMode || 'devlogin'),
    authOrigin: profile?.authOrigin ? parseRuntimeOrigin(profile.authOrigin, { allowlist }).origin : parsed.origin,
    appOrigin: profile?.appOrigin ? parseRuntimeOrigin(profile.appOrigin, { allowlist }).origin : parsed.origin,
    prostage: profile?.prostage ? String(profile.prostage) : null,
    originAllowlist: parsed.allowlist,
  };
}

function secretForClientId(clientId) {
  return String(clientId || '').split('-').sort().join('%');
}

function encryptRequest(payload, clientId) {
  return CryptoJS.AES.encrypt(JSON.stringify(payload), secretForClientId(clientId)).toString();
}

function decryptResponse(token, clientId) {
  const plaintext = CryptoJS.AES.decrypt(String(token), secretForClientId(clientId)).toString(CryptoJS.enc.Utf8);
  if (!plaintext) throw new RuntimeClientError('RUNTIME_DECRYPTION_FAILED', 'Runtime returned an encrypted response that could not be decrypted.', 502);
  try {
    let value = JSON.parse(plaintext);
    if (typeof value === 'string') value = JSON.parse(value);
    return { Result: value };
  } catch {
    throw new RuntimeClientError('RUNTIME_DECRYPTION_FAILED', 'Runtime returned an invalid encrypted response.', 502);
  }
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,]+=)/g);
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new RuntimeClientError('RUNTIME_RESPONSE_TOO_LARGE', 'Runtime response exceeded the configured size limit.', 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) throw new RuntimeClientError('RUNTIME_RESPONSE_TOO_LARGE', 'Runtime response exceeded the configured size limit.', 502);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new RuntimeClientError('RUNTIME_INVALID_JSON', 'Runtime returned invalid JSON.', 502);
  }
}

function pinnedHttpsFetch(url, init, validation) {
  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(url);
    const selectedAddress = validation.addresses[0];
    const family = net.isIP(selectedAddress);
    const headers = { ...(init.headers || {}) };
    if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body));
    const request = https.request({
      protocol: 'https:',
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: init.method || 'GET',
      headers,
      servername: target.hostname,
      rejectUnauthorized: true,
      lookup: (_hostname, options, callback) => {
        const cb = typeof options === 'function' ? options : callback;
        const lookupOptions = typeof options === 'function' ? {} : (options || {});
        if (lookupOptions.all) return cb(null, [{ address: selectedAddress, family }]);
        return cb(null, selectedAddress, family);
      },
    }, response => {
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          request.destroy(new RuntimeClientError('RUNTIME_RESPONSE_TOO_LARGE', 'Runtime response exceeded the configured size limit.', 502));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const responseHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          responseHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        }
        const bytes = Buffer.concat(chunks);
        resolve({
          status: response.statusCode || 0,
          ok: Number(response.statusCode || 0) >= 200 && Number(response.statusCode || 0) < 300,
          headers: responseHeaders,
          arrayBuffer: async () => bytes,
        });
      });
    });
    request.on('error', reject);
    if (init.signal) {
      if (init.signal.aborted) request.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      else init.signal.addEventListener('abort', () => request.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
    }
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}

async function fetchOnce(state, absoluteUrl, options = {}) {
  if (!state?.clientId || !state?.cookieJar) throw new RuntimeClientError('RUNTIME_SESSION_INVALID', 'Runtime session state is invalid.', 401);
  const targetUrl = absoluteUrl instanceof URL ? absoluteUrl : new URL(String(absoluteUrl));
  const origin = targetUrl.origin;
  const validation = await validateRuntimeOrigin(origin, {
    ...options,
    allowlist: options.allowlist || options.originAllowlist || [],
  });
  const jar = CookieJar.deserializeSync(state.cookieJar);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    accept: options.accept || '*/*',
    'client-id': state.clientId,
    origin,
    referer: options.referer || `${origin}/`,
    ...(options.headers || {}),
  };
  const cookie = await jar.getCookieString(targetUrl.toString());
  if (cookie) headers.cookie = cookie;
  let body;
  if (options.payload !== undefined) {
    const outbound = state.ecreq === true ? { reqtoken: encryptRequest(options.payload, state.clientId) } : options.payload;
    body = JSON.stringify(outbound);
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new RuntimeClientError('RUNTIME_REQUEST_TOO_LARGE', 'Runtime request exceeded the configured size limit.', 413);
    headers['content-type'] = 'application/json; charset=UTF-8';
  }
  let response;
  try {
    const init = {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      signal: controller.signal,
    };
    response = options.fetchImpl
      ? await options.fetchImpl(targetUrl, init)
      : await pinnedHttpsFetch(targetUrl, init, validation);
  } catch (error) {
    const timeoutError = error?.name === 'AbortError';
    throw new RuntimeClientError(timeoutError ? 'RUNTIME_TIMEOUT' : 'RUNTIME_UNAVAILABLE', timeoutError ? 'Runtime request timed out.' : 'Runtime could not be reached.', timeoutError ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
  for (const value of setCookieValues(response.headers)) {
    await jar.setCookie(value, targetUrl.toString(), { ignoreError: true });
  }
  state.cookieJar = jar.serializeSync();
  state.lastUsedAt = new Date().toISOString();
  return { response, state, url: targetUrl, origin, validation };
}

async function fetchSameOrigin(state, profileInput, path, options = {}) {
  const profile = normalizedProfile(profileInput);
  const url = new URL(normalizePath(path), profile.origin);
  const result = await fetchOnce(state, url, {
    ...options,
    allowlist: profile.originAllowlist,
    referer: new URL(options.refererPath || profile.appRefererPath, profile.origin).toString(),
    headers: {
      ...(options.prostage || profile.prostage ? { prostage: String(options.prostage || profile.prostage) } : {}),
      ...(options.headers || {}),
    },
  });
  if (result.response.status >= 300 && result.response.status < 400) {
    const location = result.response.headers.get('location');
    const redirectOrigin = location ? new URL(location, profile.origin).origin : '';
    throw new RuntimeClientError(redirectOrigin && redirectOrigin !== profile.origin ? 'RUNTIME_CROSS_ORIGIN_REDIRECT' : 'RUNTIME_REDIRECT_REJECTED', 'Runtime redirects are not followed.', 502);
  }
  if (!result.response.ok) throw new RuntimeClientError('RUNTIME_HTTP_ERROR', `Runtime returned HTTP ${result.response.status}.`, 502);
  return { response: result.response, state: result.state, profile };
}

/**
 * Follow redirects across allowlisted origins (SOHA → app handoff).
 * Collects Set-Cookie on every hop into the shared jar.
 */
async function fetchFollowingRedirects(state, startUrl, options = {}) {
  const maxRedirects = Number(options.maxRedirects || 8);
  let current = new URL(String(startUrl));
  let last = null;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    last = await fetchOnce(state, current, {
      ...options,
      method: options.method || 'GET',
      payload: hop === 0 ? options.payload : undefined,
      accept: options.accept || 'text/html,application/xhtml+xml,application/json',
    });
    if (last.response.status < 300 || last.response.status >= 400) {
      if (!last.response.ok && !options.allowErrorStatus) {
        throw new RuntimeClientError('RUNTIME_HTTP_ERROR', `Runtime returned HTTP ${last.response.status}.`, 502);
      }
      return last;
    }
    const location = last.response.headers.get('location');
    if (!location) {
      throw new RuntimeClientError('RUNTIME_REDIRECT_REJECTED', 'Runtime redirect missing Location header.', 502);
    }
    current = new URL(location, current);
    try {
      parseRuntimeOrigin(current.origin, { allowlist: options.allowlist || options.originAllowlist || [] });
    } catch (error) {
      if (error instanceof RuntimeClientError) throw error;
      throw new RuntimeClientError('RUNTIME_CROSS_ORIGIN_REDIRECT', 'Runtime redirect left the allowlisted origin set.', 502);
    }
  }
  throw new RuntimeClientError('RUNTIME_REDIRECT_REJECTED', 'Runtime exceeded the redirect hop limit.', 502);
}

async function initializeRuntime(state, profile, options = {}) {
  const normalized = normalizedProfile(profile);
  if (!normalized.loginPath) return state;
  await fetchSameOrigin(state, profile, normalized.loginPath, {
    ...options,
    method: 'GET',
    refererPath: normalized.loginPath,
    accept: 'text/html,application/xhtml+xml',
  });
  return state;
}

async function postCore(state, profileInput, endpoint, payload, options = {}) {
  const profile = normalizedProfile(profileInput);
  const requestOrigin = options.useAuthOrigin === true ? profile.authOrigin : (options.origin || profile.appOrigin || profile.origin);
  const result = await fetchSameOrigin(state, {
    ...profile,
    origin: requestOrigin,
    appRefererPath: options.refererPath || (options.login === true && profile.loginPath ? profile.loginPath : profile.appRefererPath),
  }, `${profile.coreBasePath}/data-provider/${endpoint}`, {
    ...options,
    method: 'POST',
    payload,
    refererPath: options.login === true && profile.loginPath ? profile.loginPath : profile.appRefererPath,
    headers: {
      ...(profile.prostage || options.prostage ? { prostage: String(options.prostage || profile.prostage) } : {}),
      ...(options.headers || {}),
    },
  });
  let parsed = await readBoundedJson(result.response);
  if (parsed?.token) parsed = decryptResponse(parsed.token, state.clientId);
  if (typeof parsed?.Result?.ecreq === 'boolean') state.ecreq = parsed.Result.ecreq;
  return { response: parsed, state, profile };
}

function resultOf(response) {
  return response?.Result || {};
}

function logicalErrorOf(response) {
  const result = resultOf(response);
  if (response?.error) return String(response.error);
  if (result?.error) return typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
  if (result?.success === false) return String(result.message || 'Runtime operation failed.');
  if (['error', 'danger'].includes(result?.serverMessage?.type)) return String(result.serverMessage.text || 'Runtime operation failed.');
  return null;
}

function assertLogicalSuccess(response) {
  const message = logicalErrorOf(response);
  if (message) throw new RuntimeClientError('RUNTIME_LOGICAL_ERROR', message, 502);
  return response;
}

async function runtimeWhoAmI(state, profile, options = {}) {
  const normalized = normalizedProfile(profile);
  const whoOrigin = options.origin || normalized.appOrigin || normalized.origin;
  return postCore(state, {
    ...normalized,
    origin: whoOrigin,
    runtimeServiceId: options.runtimeServiceId || new URL(whoOrigin).host,
  }, 'get-data-source', {
    serviceId: options.runtimeServiceId || new URL(whoOrigin).host,
    key: (normalized.readyCheck && normalized.readyCheck.key) || 'pages-app/who-am-i',
    params: {},
  }, { ...options, login: true, prostage: options.prostage || normalized.prostage });
}

async function startRuntimeLogin(profileInput, phone, options = {}) {
  const profile = normalizedProfile(profileInput);
  const state = createRuntimeState(profile.id);
  await initializeRuntime(state, profile, options);
  await runtimeWhoAmI(state, profile, options);
  const phoneResult = await postCore(state, profile, 'store-form-data', {
    serviceId: profile.runtimeServiceId,
    formId: 'auth/signin/iran-cellphone',
    data: { userSource: profile.userSource, userLoginName: String(phone) },
  }, { ...options, login: true });
  assertLogicalSuccess(phoneResult.response);
  const result = resultOf(phoneResult.response);
  const nextStep = String(result.nextStep || result.NextStep || '').toLowerCase();
  state.loginName = String(phone);
  if (nextStep.includes('password')) {
    state.phase = 'PASSWORD_REQUIRED';
    return { state, status: { connected: false, nextStep: 'password', ecreq: state.ecreq } };
  }
  if (nextStep.includes('loggedin') || result.IsUserLogin === true) {
    const verified = await runtimeWhoAmI(state, profile, options);
    if (resultOf(verified.response).IsUserLogin !== true) {
      throw new RuntimeClientError('RUNTIME_LOGIN_NOT_VERIFIED', 'Runtime did not confirm the authenticated session.', 401);
    }
    state.phase = 'CONNECTED';
    state.runtimeUser = resultOf(verified.response).LoginUser || result.LoginUser || {};
    state.connectedAt = new Date().toISOString();
    return { state, status: publicRuntimeStatus(state) };
  }
  throw new RuntimeClientError('RUNTIME_UNEXPECTED_LOGIN_STEP', 'Runtime returned an unsupported login step.', 502);
}

async function finishRuntimeLogin(state, profileInput, password, options = {}) {
  const profile = normalizedProfile(profileInput);
  if (state?.phase !== 'PASSWORD_REQUIRED' || !state.loginName) {
    throw new RuntimeClientError('RUNTIME_LOGIN_NOT_STARTED', 'Start the Runtime login before sending a password.', 409);
  }
  const passwordResult = await postCore(state, profile, 'store-form-data', {
    serviceId: profile.runtimeServiceId,
    formId: 'auth/signin/check-password',
    data: {
      userSource: profile.userSource,
      userLoginName: state.loginName,
      contact: 'iran-cellphone',
      password: String(password),
    },
  }, { ...options, login: true });
  assertLogicalSuccess(passwordResult.response);
  const nextStep = String(resultOf(passwordResult.response).nextStep || '').toLowerCase();
  if (nextStep && !nextStep.includes('loggedin') && resultOf(passwordResult.response).IsUserLogin !== true) {
    throw new RuntimeClientError('RUNTIME_INVALID_CREDENTIALS', 'Runtime did not accept the supplied credentials.', 401);
  }
  const verified = await runtimeWhoAmI(state, profile, options);
  const result = resultOf(verified.response);
  if (result.IsUserLogin !== true) throw new RuntimeClientError('RUNTIME_INVALID_CREDENTIALS', 'Runtime did not confirm the authenticated session.', 401);
  state.phase = 'CONNECTED';
  state.runtimeUser = result.LoginUser || resultOf(passwordResult.response).LoginUser || {};
  state.connectedAt = new Date().toISOString();
  delete state.password;
  return { state, status: publicRuntimeStatus(state) };
}

function publicRuntimeStatus(state) {
  if (!state) return { connected: false, phase: 'DISCONNECTED' };
  return {
    connected: state.phase === 'CONNECTED',
    phase: state.phase || 'DISCONNECTED',
    profileId: state.profileId,
    loginName: state.loginName,
    runtimeUser: state.runtimeUser || null,
    ecreq: Boolean(state.ecreq),
    connectedAt: state.connectedAt,
    lastUsedAt: state.lastUsedAt,
  };
}

async function executeCoreOperation(state, profileInput, operation, input, options = {}) {
  if (state?.phase !== 'CONNECTED') throw new RuntimeClientError('RUNTIME_SESSION_REQUIRED', 'Connect to this Runtime Profile before execution.', 401);
  const profile = normalizedProfile(profileInput);
  if (!profile.projectServiceId) throw new RuntimeClientError('RUNTIME_SERVICE_ID_REQUIRED', 'The Runtime Profile needs an approved project service ID.', 409);
  const sourceId = String(operation?.sourceId || operation?.moduleId || '');
  const operationType = operation?.type || (sourceId.startsWith('fr/') ? 'CORE_COMMAND' : 'CORE_QUERY');
  const isCommand = operationType === 'CORE_COMMAND';
  const expectedPrefix = isCommand ? 'fr/' : 'ds/';
  if (!sourceId.startsWith(expectedPrefix)) throw new RuntimeClientError('RUNTIME_BINDING_INVALID', 'The discovered operation binding is invalid.', 422);
  const providerId = sourceId.slice(expectedPrefix.length);
  const payload = isCommand
    ? { serviceId: profile.projectServiceId, formId: providerId, data: input && typeof input === 'object' ? input : {} }
    : { serviceId: profile.projectServiceId, key: providerId, params: input && typeof input === 'object' ? input : {} };
  return postCore(state, profile, isCommand ? 'store-form-data' : 'get-data-source', payload, {
    ...options,
    prostage: profile.prostage || undefined,
  });
}

module.exports = {
  DEFAULT_CORE_BASE_PATH,
  DEFAULT_LOGIN_PATH,
  DEFAULT_USER_SOURCE,
  RuntimeClientError,
  assertLogicalSuccess,
  createClientId,
  createRuntimeState,
  decryptResponse,
  encryptRequest,
  executeCoreOperation,
  fetchFollowingRedirects,
  fetchOnce,
  fetchSameOrigin,
  finishRuntimeLogin,
  hostAllowed,
  hostAllowsIntranetResolution,
  hostMatchesRule,
  intranetOriginAllowlist,
  isPrivateIp,
  isUnsafeEvenForIntranet,
  normalizedProfile,
  originAllowlist,
  parseRuntimeOrigin,
  postCore,
  publicRuntimeStatus,
  runtimeWhoAmI,
  secretForClientId,
  startRuntimeLogin,
  validateRuntimeOrigin,
};

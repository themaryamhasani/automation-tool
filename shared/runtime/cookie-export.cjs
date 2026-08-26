const { CookieJar } = require('tough-cookie');

async function cookieHeaderFromState(state, origin) {
  if (!state?.cookieJar || !origin) return '';
  const jar = CookieJar.deserializeSync(state.cookieJar);
  const url = new URL('/', String(origin)).toString();
  return String(await jar.getCookieString(url) || '').trim();
}

async function cookieHeadersForScopes(state, origins = []) {
  const scopes = Array.from(new Set((origins || []).map(item => String(item || '').trim().replace(/\/$/, '')).filter(Boolean)));
  const headers = {};
  for (const origin of scopes) {
    headers[origin] = await cookieHeaderFromState(state, origin);
  }
  return headers;
}

function cookieUrlForEntry(cookie) {
  const domain = String(cookie.domain || cookie.Domain || '').replace(/^\./, '');
  const pathValue = String(cookie.path || cookie.Path || '/');
  const secure = cookie.secure !== false && cookie.Secure !== false;
  const scheme = secure === false ? 'http' : 'https';
  if (!domain) return '';
  return `${scheme}://${domain}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
}

/** True when value looks like a Cookie request header (`a=1; b=2`), not a single cookie value. */
function looksLikeCookieHeader(value) {
  const text = String(value || '').trim();
  if (!text.includes('=') || !text.includes(';')) return false;
  const pairs = text.split(';').map(part => part.trim()).filter(Boolean);
  if (pairs.length < 2) return false;
  return pairs.every(part => /^[^=;\s]+=.*/.test(part));
}

function parseCookieHeaderPairs(headerValue) {
  return String(headerValue || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const eq = part.indexOf('=');
      if (eq <= 0) return null;
      return {
        name: part.slice(0, eq).trim(),
        value: part.slice(eq + 1),
      };
    })
    .filter(Boolean);
}

/**
 * Accept Playwright storageState cookies OR DevTools "Cookie" header paste:
 * { name: "Cookie", value: "_lsr=...; _ga=...", domain, path, secure, httpOnly }
 */
function normalizeCookieEntries(cookies = []) {
  const list = Array.isArray(cookies) ? cookies : [];
  const out = [];
  for (const cookie of list) {
    if (!cookie || typeof cookie !== 'object') continue;
    const name = String(cookie.name || cookie.Name || '').trim();
    const value = cookie.value != null ? String(cookie.value) : (cookie.Value != null ? String(cookie.Value) : '');
    const isHeaderBag = !name || /^cookie$/i.test(name) || looksLikeCookieHeader(value);
    if (isHeaderBag && looksLikeCookieHeader(value)) {
      for (const pair of parseCookieHeaderPairs(value)) {
        out.push({
          ...cookie,
          name: pair.name,
          value: pair.value,
          // Session cookie from live app is HttpOnly; analytics usually are not — mark _lsr as such.
          httpOnly: pair.name === '_lsr' ? true : Boolean(cookie.httpOnly || cookie.HttpOnly),
          secure: cookie.secure !== false && cookie.Secure !== false,
        });
      }
      continue;
    }
    if (!name) continue;
    out.push(cookie);
  }
  return out;
}

async function importCookiesIntoState(state, cookies = []) {
  if (!state) throw new Error('RUNTIME_SESSION_INVALID');
  const jar = state.cookieJar ? CookieJar.deserializeSync(state.cookieJar) : new CookieJar();
  const list = normalizeCookieEntries(cookies);
  for (const cookie of list) {
    if (!cookie || typeof cookie !== 'object') continue;
    const name = String(cookie.name || cookie.Name || '').trim();
    const value = cookie.value != null ? String(cookie.value) : (cookie.Value != null ? String(cookie.Value) : '');
    if (!name) continue;
    const domain = String(cookie.domain || cookie.Domain || '').replace(/^\./, '');
    const pathValue = String(cookie.path || cookie.Path || '/') || '/';
    const url = cookieUrlForEntry(cookie);
    if (!url) continue;
    const parts = [`${name}=${value}`, `Path=${pathValue}`];
    if (domain) parts.push(`Domain=${domain}`);
    if (cookie.secure !== false && cookie.Secure !== false) parts.push('Secure');
    if (cookie.httpOnly || cookie.HttpOnly) parts.push('HttpOnly');
    if (cookie.sameSite || cookie.SameSite) parts.push(`SameSite=${cookie.sameSite || cookie.SameSite}`);
    if (cookie.expires && cookie.expires !== -1) {
      const expires = new Date(cookie.expires * (cookie.expires < 1e12 ? 1000 : 1));
      if (!Number.isNaN(expires.getTime())) parts.push(`Expires=${expires.toUTCString()}`);
    }
    await jar.setCookie(parts.join('; '), url, { ignoreError: true });
  }
  state.cookieJar = jar.serializeSync();
  state.lastUsedAt = new Date().toISOString();
  return state;
}

async function importStorageStateIntoState(state, storageState) {
  if (typeof storageState === 'string' && looksLikeCookieHeader(storageState)) {
    return importCookiesIntoState(state, [{
      name: 'Cookie',
      value: storageState,
      domain: 'tavan.medu.ir',
      path: '/',
      secure: true,
    }]);
  }
  const cookies = Array.isArray(storageState?.cookies)
    ? storageState.cookies
    : (Array.isArray(storageState) ? storageState : []);
  return importCookiesIntoState(state, cookies);
}

async function storageStateFromState(state, origins = []) {
  if (!state?.cookieJar) return { cookies: [], origins: [] };
  const jar = CookieJar.deserializeSync(state.cookieJar);
  const scopes = Array.from(new Set((origins || []).map(item => String(item || '').trim().replace(/\/$/, '')).filter(Boolean)));
  const cookies = [];
  const seen = new Set();
  for (const origin of scopes.length ? scopes : ['https://invalid.local']) {
    const list = scopes.length
      ? await jar.getCookies(new URL('/', origin).toString())
      : [];
    for (const cookie of list) {
      const key = `${cookie.key}|${cookie.domain}|${cookie.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cookies.push({
        name: cookie.key,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires === 'Infinity' ? -1 : Math.floor(new Date(cookie.expires).getTime() / 1000),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: cookie.sameSite || 'Lax',
      });
    }
  }
  if (!scopes.length) {
    const serialized = jar.serializeSync();
    for (const cookie of serialized.cookies || []) {
      cookies.push({
        name: cookie.key,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires === 'Infinity' ? -1 : Math.floor(new Date(cookie.expires).getTime() / 1000),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: cookie.sameSite || 'Lax',
      });
    }
  }
  return { cookies, origins: scopes };
}

module.exports = {
  cookieHeaderFromState,
  cookieHeadersForScopes,
  looksLikeCookieHeader,
  normalizeCookieEntries,
  parseCookieHeaderPairs,
  importCookiesIntoState,
  importStorageStateIntoState,
  storageStateFromState,
};

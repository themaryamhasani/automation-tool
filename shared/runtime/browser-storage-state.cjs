/**
 * Validate / normalize a Playwright storageState payload captured from Chrome Recorder.
 * Keeps cookies + origins; never accepts arbitrary secrets blobs.
 */

const MAX_COOKIES = 400;
const MAX_ORIGINS = 80;
const MAX_JSON_BYTES = 512 * 1024;

function asString(value, max = 8_000) {
  return String(value == null ? '' : value).slice(0, max);
}

function normalizeCookie(cookie, fallbackDomain = '') {
  if (!cookie || typeof cookie !== 'object') return null;
  const name = asString(cookie.name || cookie.Name, 256).trim();
  const value = asString(cookie.value != null ? cookie.value : cookie.Value, 16_000);
  if (!name || !value) return null;
  const domain = asString(cookie.domain || cookie.Domain || fallbackDomain, 255).replace(/^\./, '');
  if (!domain) return null;
  const expiresRaw = cookie.expires ?? cookie.Expires ?? -1;
  const expires = Number.isFinite(Number(expiresRaw)) ? Number(expiresRaw) : -1;
  return {
    name,
    value,
    domain,
    path: asString(cookie.path || cookie.Path || '/', 512) || '/',
    expires,
    httpOnly: Boolean(cookie.httpOnly || cookie.HttpOnly),
    secure: cookie.secure !== false && cookie.Secure !== false,
    sameSite: asString(cookie.sameSite || cookie.SameSite || 'Lax', 32) || 'Lax',
  };
}

function normalizeOrigin(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const origin = asString(entry.origin, 512).trim();
  if (!/^https?:\/\//i.test(origin)) return null;
  const localStorage = Array.isArray(entry.localStorage)
    ? entry.localStorage
      .map(item => {
        if (!item || typeof item !== 'object') return null;
        const name = asString(item.name, 512);
        if (!name) return null;
        return { name, value: asString(item.value, 32_000) };
      })
      .filter(Boolean)
      .slice(0, 200)
    : [];
  return { origin, localStorage };
}

function normalizeBrowserStorageState(raw) {
  if (!raw || typeof raw !== 'object') {
    const error = new Error('browserStorageState باید یک شیء Playwright storageState باشد.');
    error.code = 'INVALID_BROWSER_STORAGE_STATE';
    throw error;
  }
  const fallbackDomain = (() => {
    const fromCookie = (Array.isArray(raw.cookies) ? raw.cookies : [])
      .map(item => asString(item?.domain || item?.Domain, 255).replace(/^\./, ''))
      .find(Boolean);
    if (fromCookie) return fromCookie;
    const origin = (Array.isArray(raw.origins) ? raw.origins : [])
      .map(item => {
        try { return new URL(String(item?.origin || '')).hostname; } catch { return ''; }
      })
      .find(Boolean);
    return origin || '';
  })();
  const cookies = (Array.isArray(raw.cookies) ? raw.cookies : [])
    .map(cookie => normalizeCookie(cookie, fallbackDomain))
    .filter(Boolean)
    .slice(0, MAX_COOKIES);
  const origins = (Array.isArray(raw.origins) ? raw.origins : [])
    .map(normalizeOrigin)
    .filter(Boolean)
    .slice(0, MAX_ORIGINS);
  if (!cookies.length) {
    const error = new Error('نشست مرورگر کوکی معتبری نداشت؛ روی صفحهٔ لاگین‌شده بمانید و دوباره Run بزنید.');
    error.code = 'BROWSER_STORAGE_STATE_EMPTY';
    throw error;
  }
  const normalized = { cookies, origins };
  const encoded = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (encoded > MAX_JSON_BYTES) {
    const error = new Error('حجم نشست مرورگر بیش از حد مجاز است.');
    error.code = 'BROWSER_STORAGE_STATE_TOO_LARGE';
    throw error;
  }
  return normalized;
}

module.exports = {
  MAX_JSON_BYTES,
  normalizeBrowserStorageState,
};

/**
 * Decide whether a Playwright storageState is enough for a fresh Chromium Save & Run.
 */

const ANALYTICS_COOKIE = /^(?:_ga|_gid|_gat|_gcl|_fbp|_fbc|_ym|_hj|_sp_)/i;
const AUTH_COOKIE_NAME = /(?:^|[_-])(lsr|sid|session|auth|token|jwt|refresh|cdesc)(?:$|[_-])/i;

function cookieMatchesHost(domain, host) {
  const d = String(domain || '').toLowerCase().replace(/^\./, '');
  const h = String(host || '').toLowerCase();
  if (!d || !h) return false;
  if (h === d || h.endsWith(`.${d}`)) {
    const hostLabels = h.split('.').length;
    const domainLabels = d.split('.').length;
    if (hostLabels - domainLabels <= 1) return true;
    if (d.startsWith('m.') || d.includes('medu')) return true;
  }
  return false;
}

function looksAuthenticatedAppUrl(pageUrl = '') {
  try {
    const parsed = new URL(pageUrl);
    if (!/adib\.m\.edus\.ir$/i.test(parsed.hostname)) return false;
    if (/\/(login|devlogin|signin|sso|auth)(\/|$)/i.test(parsed.pathname)) return false;
    return /\/camp(\/|$)/i.test(parsed.pathname);
  } catch {
    return /adib\.m\.edus\.ir\/camp/i.test(String(pageUrl || ''));
  }
}

function assessBrowserSession(storageState, pageUrl = '') {
  let host = '';
  try { host = new URL(pageUrl).hostname.toLowerCase(); } catch { host = ''; }
  if (!host) {
    const fromCookie = (storageState?.cookies || [])
      .map(item => String(item.domain || '').toLowerCase())
      .find(domain => /adib\.|soha\./i.test(domain));
    host = fromCookie || '';
  }
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
  const domains = [...new Set(cookies.map(item => String(item.domain || '').toLowerCase()).filter(Boolean))];
  const nonAnalytics = cookies.filter(cookie => !ANALYTICS_COOKIE.test(String(cookie.name || '')));
  const forHost = nonAnalytics.filter(cookie => cookieMatchesHost(cookie.domain, host));
  const httpOnlyForHost = forHost.filter(cookie => cookie.httpOnly);
  const authNamedForHost = forHost.filter(cookie => AUTH_COOKIE_NAME.test(String(cookie.name || '')));
  const ssoCookies = nonAnalytics.filter(cookie => /soha\./i.test(String(cookie.domain || '')));
  const needsSsoFamily = /\.m\.edus\.ir$/i.test(host) || /adib\./i.test(host) || /adib\.m\.edus\.ir/i.test(pageUrl);
  const authedApp = looksAuthenticatedAppUrl(pageUrl);
  const hasAppSession = httpOnlyForHost.length >= 1 || authNamedForHost.length >= 1;

  if (!cookies.length) {
    return {
      ok: false, total: 0, forHost: 0, httpOnlyForHost: 0, ssoCookies: 0, domains, reason: 'empty',
    };
  }
  if (host && !forHost.length && !ssoCookies.length) {
    return {
      ok: false, total: cookies.length, forHost: 0, httpOnlyForHost: 0, ssoCookies: 0, domains, reason: 'no-host-cookies',
    };
  }
  // Prefer soha SSO cookies when readable. If Chrome hides partitioned soha cookies,
  // accept a real adib app session while the live tab is already inside /camp/*.
  if (needsSsoFamily && ssoCookies.length < 1 && !(hasAppSession && authedApp)) {
    return {
      ok: false,
      total: cookies.length,
      forHost: forHost.length,
      httpOnlyForHost: httpOnlyForHost.length,
      ssoCookies: 0,
      domains,
      reason: hasAppSession ? 'not-on-app-page' : 'missing-sso',
    };
  }
  if (nonAnalytics.length < 1 && ssoCookies.length < 1) {
    return {
      ok: false,
      total: cookies.length,
      forHost: forHost.length,
      httpOnlyForHost: httpOnlyForHost.length,
      ssoCookies: ssoCookies.length,
      domains,
      reason: 'thin-session',
    };
  }
  return {
    ok: true,
    total: cookies.length,
    forHost: forHost.length,
    httpOnlyForHost: httpOnlyForHost.length,
    ssoCookies: ssoCookies.length,
    domains,
  };
}

function sessionAssessmentError(assessment) {
  const domains = (assessment.domains || []).join(', ') || 'none';
  if (assessment.reason === 'missing-sso') {
    return `نشست Save & Run ناقص است: نه کوکی soha پیدا شد نه کوکی لاگین httpOnly روی adib (فقط ${assessment.total} کوکی روی ${domains}). روی صفحهٔ داخل /camp/ بمانید و دوباره Run بزنید.`;
  }
  if (assessment.reason === 'not-on-app-page') {
    return `کوکی adib هست ولی تب روی صفحهٔ اپ (/camp/) نیست. به https://adib.m.edus.ir/camp/school بروید و دوباره Save & Run بزنید.`;
  }
  if (assessment.reason === 'thin-session') {
    return `نشست Save & Run فقط کوکی analytics/لاغر دارد (${assessment.total} روی ${domains}).`;
  }
  if (assessment.reason === 'no-host-cookies') {
    return `نشست Save & Run هیچ کوکی اپ/SSO برای این سایت نداشت (domains: ${domains}).`;
  }
  return 'نشست مرورگر برای اجرای سروری معتبر نبود.';
}

module.exports = {
  ANALYTICS_COOKIE,
  assessBrowserSession,
  cookieMatchesHost,
  looksAuthenticatedAppUrl,
  sessionAssessmentError,
};

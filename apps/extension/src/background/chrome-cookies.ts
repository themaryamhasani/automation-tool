import type { BrowserStorageState } from '../messaging/contracts';

export type CookieLike = {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number;
  expirationDate?: number;
  session?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

const SSO_URLS = [
  'https://adib.m.edus.ir/',
  'https://soha.m.edus.ir/',
  'https://soha.medu.ir/',
  'https://www.soha.medu.ir/',
];

const EXTRA_SSO_HOSTS = [
  'adib.m.edus.ir',
  'soha.m.edus.ir',
  'soha.medu.ir',
  'www.soha.medu.ir',
  'm.edus.ir',
];

const EXTRA_SSO_SUFFIXES = ['m.edus.ir', 'edus.ir', 'medu.ir'];
const ANALYTICS_COOKIE = /^(?:_ga|_gid|_gat|_gcl|_fbp|_fbc|_ym|_hj|_sp_)/i;

function cookieKey(cookie: { name?: string; domain?: string; path?: string }): string {
  return `${cookie.name || ''}|${String(cookie.domain || '').replace(/^\./, '')}|${cookie.path || '/'}`;
}

function sameSiteOf(value: string | undefined): 'Strict' | 'Lax' | 'None' {
  const raw = String(value || '').toLowerCase();
  if (raw === 'strict') return 'Strict';
  if (raw === 'no_restriction' || raw === 'none') return 'None';
  return 'Lax';
}

function domainsForUrl(url: string): string[] {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const parts = host.split('.').filter(Boolean);
    const domains = new Set<string>([host, ...EXTRA_SSO_HOSTS]);
    for (let i = 1; i < parts.length - 1; i += 1) {
      domains.add(parts.slice(i).join('.'));
    }
    for (const suffix of EXTRA_SSO_SUFFIXES) {
      if (host === suffix || host.endsWith(`.${suffix}`)) domains.add(suffix);
    }
    return [...domains];
  } catch {
    return [...EXTRA_SSO_HOSTS];
  }
}

function urlsForCookieQuery(pageUrl: string): string[] {
  const urls = new Set<string>(SSO_URLS);
  try {
    const parsed = new URL(pageUrl);
    if (['http:', 'https:'].includes(parsed.protocol)) urls.add(`${parsed.origin}/`);
  } catch {
    /* ignore */
  }
  return [...urls];
}

function toPlaywrightCookie(
  cookie: CookieLike,
  fallbackDomain = '',
): BrowserStorageState['cookies'][number] | null {
  const name = String(cookie.name || '').trim();
  const value = cookie.value == null ? '' : String(cookie.value);
  if (!name || !value) return null;
  const domain = String(cookie.domain || fallbackDomain || '').replace(/^\./, '');
  if (!domain) return null;
  const expires = cookie.session || (cookie.expires == null && cookie.expirationDate == null)
    ? -1
    : Math.floor(Number(cookie.expirationDate ?? cookie.expires));
  return {
    name,
    value,
    domain,
    path: cookie.path || '/',
    expires: Number.isFinite(expires) ? expires : -1,
    httpOnly: Boolean(cookie.httpOnly),
    secure: cookie.secure !== false,
    sameSite: sameSiteOf(cookie.sameSite),
  };
}

function mergeCookies(
  into: Map<string, BrowserStorageState['cookies'][number]>,
  cookies: CookieLike[],
  fallbackDomain = '',
) {
  for (const cookie of cookies) {
    const next = toPlaywrightCookie(cookie, fallbackDomain);
    if (!next) continue;
    into.set(cookieKey(next), next);
  }
}

function fillMissingDomains(
  storageState: BrowserStorageState,
  pageUrl: string,
): BrowserStorageState {
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { host = ''; }
  return {
    cookies: (storageState.cookies || []).map(cookie => ({
      ...cookie,
      domain: String(cookie.domain || host || '').replace(/^\./, ''),
    })).filter(cookie => cookie.name && cookie.value && cookie.domain),
    origins: Array.isArray(storageState.origins) ? storageState.origins : [],
  };
}

function isAppOrSsoDomain(domain: string): boolean {
  const value = String(domain || '').toLowerCase().replace(/^\./, '');
  return /(^|\.)m\.edus\.ir$|(^|\.)medu\.ir$|(^|\.)adib\.|^soha\./i.test(value);
}

function cookieMatchesHost(domain: string, host: string): boolean {
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

function looksAuthenticatedAppUrl(pageUrl = ''): boolean {
  try {
    const parsed = new URL(pageUrl);
    if (!/adib\.m\.edus\.ir$/i.test(parsed.hostname)) return false;
    if (/\/(login|devlogin|signin|sso|auth)(\/|$)/i.test(parsed.pathname)) return false;
    return /\/camp(\/|$)/i.test(parsed.pathname);
  } catch {
    return /adib\.m\.edus\.ir\/camp/i.test(String(pageUrl || ''));
  }
}

export function assessBrowserSession(
  storageState: BrowserStorageState,
  pageUrl: string,
): {
  ok: boolean;
  total: number;
  forHost: number;
  httpOnlyForHost: number;
  ssoCookies: number;
  authCookies: number;
  domains: string[];
  reason?: string;
} {
  let host = '';
  try { host = new URL(pageUrl).hostname.toLowerCase(); } catch { host = ''; }
  const cookies = storageState.cookies || [];
  const domains = [...new Set(cookies.map(item => String(item.domain || '').toLowerCase()).filter(Boolean))];
  const nonAnalytics = cookies.filter(cookie => !ANALYTICS_COOKIE.test(cookie.name));
  const forHost = nonAnalytics.filter(cookie => cookieMatchesHost(cookie.domain, host));
  const httpOnlyForHost = forHost.filter(cookie => cookie.httpOnly);
  const authNamedForHost = forHost.filter(cookie => /(?:^|[_-])(lsr|sid|session|auth|token|jwt|refresh|cdesc)(?:$|[_-])/i.test(cookie.name));
  const ssoCookies = nonAnalytics.filter(cookie => /soha\./i.test(String(cookie.domain || '')));
  const authCookies = nonAnalytics.filter(cookie => (
    /(?:^|[_-])(lsr|sid|session|auth|token|jwt|refresh|cdesc)(?:$|[_-])/i.test(cookie.name)
    || cookie.httpOnly
  ));
  const needsSsoFamily = /\.m\.edus\.ir$/i.test(host) || /adib\./i.test(host);
  const authedApp = looksAuthenticatedAppUrl(pageUrl);
  const hasAppSession = httpOnlyForHost.length >= 1 || authNamedForHost.length >= 1;

  if (!cookies.length) {
    return {
      ok: false, total: 0, forHost: 0, httpOnlyForHost: 0, ssoCookies: 0, authCookies: 0, domains, reason: 'empty',
    };
  }
  if (host && !forHost.length && !ssoCookies.length) {
    return {
      ok: false,
      total: cookies.length,
      forHost: 0,
      httpOnlyForHost: 0,
      ssoCookies: 0,
      authCookies: authCookies.length,
      domains,
      reason: 'no-host-cookies',
    };
  }
  if (needsSsoFamily && ssoCookies.length < 1 && !(hasAppSession && authedApp)) {
    return {
      ok: false,
      total: cookies.length,
      forHost: forHost.length,
      httpOnlyForHost: httpOnlyForHost.length,
      ssoCookies: 0,
      authCookies: authCookies.length,
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
      authCookies: authCookies.length,
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
    authCookies: authCookies.length,
    domains,
  };
}

export async function enrichStorageStateWithChromeCookies(
  storageState: BrowserStorageState,
  pageUrl: string,
): Promise<BrowserStorageState> {
  const seeded = fillMissingDomains(storageState, pageUrl);
  const merged = new Map<string, BrowserStorageState['cookies'][number]>();
  mergeCookies(merged, seeded.cookies || []);
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { host = ''; }

  if (chrome.cookies?.getAll) {
    for (const domain of domainsForUrl(pageUrl)) {
      try {
        mergeCookies(merged, await chrome.cookies.getAll({ domain }), host);
      } catch {
        /* permission may be missing */
      }
    }
    for (const url of urlsForCookieQuery(pageUrl)) {
      try {
        mergeCookies(merged, await chrome.cookies.getAll({ url }), host);
      } catch {
        /* ignore */
      }
    }
    const topLevelSites = urlsForCookieQuery(pageUrl).map(item => {
      try { return new URL(item).origin; } catch { return ''; }
    }).filter(Boolean);
    for (const topLevelSite of topLevelSites) {
      for (const url of urlsForCookieQuery(pageUrl)) {
        try {
          mergeCookies(
            merged,
            await chrome.cookies.getAll({ url, partitionKey: { topLevelSite } }),
            host,
          );
        } catch {
          /* partitioned cookies unsupported / denied */
        }
      }
      for (const domain of EXTRA_SSO_HOSTS) {
        try {
          mergeCookies(
            merged,
            await chrome.cookies.getAll({ domain, partitionKey: { topLevelSite } }),
            host,
          );
        } catch {
          /* ignore */
        }
      }
    }
    try {
      const stores = await chrome.cookies.getAllCookieStores?.() || [];
      for (const store of stores) {
        for (const url of urlsForCookieQuery(pageUrl)) {
          try {
            mergeCookies(merged, await chrome.cookies.getAll({ url, storeId: store.id }), host);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* older chrome */
    }
  }

  return {
    cookies: [...merged.values()],
    origins: Array.isArray(seeded.origins) ? seeded.origins : [],
  };
}

/** Pull the full browser cookie jar via context/CDP (includes SSO hosts CRX storageState often misses). */
export async function enrichStorageStateWithCdpCookies(
  page: any,
  storageState: BrowserStorageState,
  pageUrl: string,
): Promise<BrowserStorageState> {
  const merged = new Map<string, BrowserStorageState['cookies'][number]>();
  mergeCookies(merged, storageState.cookies || []);
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { host = ''; }

  try {
    const context = page.context();
    if (typeof context.cookies === 'function') {
      const list = await context.cookies(urlsForCookieQuery(pageUrl));
      mergeCookies(
        merged,
        (list || []).filter((cookie: CookieLike) => isAppOrSsoDomain(String(cookie.domain || ''))),
        host,
      );
    }
  } catch {
    /* ignore */
  }

  try {
    const context = page.context();
    if (typeof context.newCDPSession === 'function') {
      const session = await context.newCDPSession(page);
      const result = await session.send('Network.getAllCookies');
      mergeCookies(
        merged,
        (result.cookies || []).filter((cookie: CookieLike) => isAppOrSsoDomain(String(cookie.domain || ''))),
        host,
      );
    }
  } catch {
    /* playwright-crx may not expose CDP on every build */
  }

  return {
    cookies: [...merged.values()],
    origins: Array.isArray(storageState.origins) ? storageState.origins : [],
  };
}

/** Use the extension debugger (already attached by playwright-crx) to read the full jar. */
export async function enrichStorageStateWithDebuggerCookies(
  tabId: number | null | undefined,
  storageState: BrowserStorageState,
  pageUrl: string,
): Promise<BrowserStorageState> {
  if (tabId == null || !chrome.debugger?.sendCommand) return storageState;
  const merged = new Map<string, BrowserStorageState['cookies'][number]>();
  mergeCookies(merged, storageState.cookies || []);
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { host = ''; }
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      'Network.getAllCookies',
    ) as { cookies?: CookieLike[] };
    mergeCookies(
      merged,
      (result.cookies || []).filter(cookie => isAppOrSsoDomain(String(cookie.domain || ''))),
      host,
    );
  } catch {
    /* debugger may be busy / not attached yet */
  }
  return {
    cookies: [...merged.values()],
    origins: Array.isArray(storageState.origins) ? storageState.origins : [],
  };
}

export function recordingHostPermissionPatterns(extraOrigins: string[] = []): string[] {
  const patterns = new Set<string>([
    'https://*.m.edus.ir/*',
    'https://*.edus.ir/*',
    'https://*.medu.ir/*',
    'https://adib.m.edus.ir/*',
    'https://soha.m.edus.ir/*',
    'https://soha.medu.ir/*',
    'https://www.soha.medu.ir/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ]);
  for (const origin of extraOrigins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      patterns.add(`${parsed.protocol}//${parsed.hostname}/*`);
    } catch {
      /* ignore */
    }
  }
  return [...patterns];
}

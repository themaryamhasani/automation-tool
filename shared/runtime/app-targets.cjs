/**
 * Per-system runtime targets (API-CONSOLE model).
 * Data lives in targets-registry.json + pack.json + catalog.project_targets (synced).
 */
const {
  loadRegistryMap,
  listPackTargetOverlays,
  rowToDef,
} = require('./target-registry.cjs');

const DEFAULT_ORIGIN = 'https://soha.m.edus.ir';
const DEFAULT_LOGIN_PATH = '/devlogin';
const AUTH_MODE_DEVLOGIN = 'devlogin';
const AUTH_MODE_SOHA_HANDOFF = 'soha-gov-sso-handoff';

const DEFAULT_READY_CHECK = {
  key: 'pages-app/who-am-i',
  expectLogin: true,
};

/** Optional in-memory overlay from DB (warmTargetsFromDb). */
let dbOverlay = Object.create(null);

function buildDevloginProfile(partial = {}) {
  const authOrigin = normalizeOrigin(partial.authOrigin || partial.appOrigin || partial.preferredOrigin || DEFAULT_ORIGIN);
  const appOrigin = normalizeOrigin(partial.appOrigin || authOrigin);
  const loginPath = normalizePath(partial.loginPath || DEFAULT_LOGIN_PATH, DEFAULT_LOGIN_PATH);
  const appPath = normalizePath(partial.appPath || '/', '/');
  return {
    authMode: AUTH_MODE_DEVLOGIN,
    authOrigin,
    appOrigin,
    loginPath,
    appPath,
    prostage: partial.prostage || null,
    handoff: null,
    readyCheck: { ...DEFAULT_READY_CHECK, ...(partial.readyCheck || {}) },
    cookieScopes: Array.from(new Set([authOrigin, appOrigin].filter(Boolean))),
    originAllowlist: partial.originAllowlist || ['*.m.edus.ir'],
    projectServiceId: String(partial.projectServiceId || '').trim(),
  };
}

function buildSohaHandoffProfile(partial = {}) {
  const authOrigin = normalizeOrigin(partial.authOrigin || 'https://soha.medu.ir');
  const appOrigin = normalizeOrigin(partial.appOrigin);
  const appPath = normalizePath(partial.appPath || '/landing', '/landing');
  const clientAccessId = String(partial.clientAccessId || partial.handoff?.clientAccessId || '').trim();
  const pathTemplate = String(
    partial.handoff?.pathTemplate
    || '/core-api/v1/data-provider/g/pwsp--medu--sso--get-token/{tokenId}?clientAccessId={clientAccessId}',
  );
  return {
    authMode: AUTH_MODE_SOHA_HANDOFF,
    authOrigin,
    appOrigin,
    loginPath: null,
    appPath,
    prostage: partial.prostage || 'develop',
    handoff: {
      type: 'soha-sso-get-token',
      clientAccessId,
      pathTemplate,
    },
    readyCheck: { ...DEFAULT_READY_CHECK, ...(partial.readyCheck || {}) },
    cookieScopes: Array.from(new Set([authOrigin, appOrigin].filter(Boolean))),
    originAllowlist: partial.originAllowlist || ['*.medu.ir', '*.m.edus.ir'],
    projectServiceId: String(partial.projectServiceId || '').trim(),
  };
}

function ensureAuthProfiles(def) {
  const raw = (def?.authProfiles && Object.keys(def.authProfiles).length)
    ? { ...def.authProfiles }
    : {};
  const existing = {};
  if (raw[AUTH_MODE_DEVLOGIN] || !raw[AUTH_MODE_SOHA_HANDOFF] || def?.authMode !== AUTH_MODE_SOHA_HANDOFF) {
    existing[AUTH_MODE_DEVLOGIN] = buildDevloginProfile({
      ...(raw[AUTH_MODE_DEVLOGIN] || {}),
      preferredOrigin: raw[AUTH_MODE_DEVLOGIN]?.preferredOrigin || raw[AUTH_MODE_DEVLOGIN]?.authOrigin || def?.preferredOrigin,
      appOrigin: raw[AUTH_MODE_DEVLOGIN]?.appOrigin,
      appPath: raw[AUTH_MODE_DEVLOGIN]?.appPath || def?.appPath,
      loginPath: raw[AUTH_MODE_DEVLOGIN]?.loginPath || def?.loginPath,
      projectServiceId: raw[AUTH_MODE_DEVLOGIN]?.projectServiceId || def?.projectServiceId,
    });
  }
  const wantsHandoff = Boolean(
    raw[AUTH_MODE_SOHA_HANDOFF]
    || def?.authMode === AUTH_MODE_SOHA_HANDOFF
    || def?.clientAccessId
    || (Array.isArray(def?.authModes) && def.authModes.includes(AUTH_MODE_SOHA_HANDOFF)),
  );
  if (wantsHandoff) {
    const partial = raw[AUTH_MODE_SOHA_HANDOFF] || {};
    existing[AUTH_MODE_SOHA_HANDOFF] = buildSohaHandoffProfile({
      ...partial,
      authOrigin: partial.authOrigin || def?.authOrigin,
      appOrigin: partial.appOrigin || def?.appOrigin,
      appPath: partial.appPath || '/landing',
      projectServiceId: partial.projectServiceId || def?.projectServiceId,
      clientAccessId: partial.clientAccessId || partial.handoff?.clientAccessId || def?.clientAccessId,
      prostage: partial.prostage,
      handoff: partial.handoff,
    });
  }
  if (!existing[AUTH_MODE_DEVLOGIN]) {
    existing[AUTH_MODE_DEVLOGIN] = buildDevloginProfile({
      preferredOrigin: def?.preferredOrigin,
      appPath: def?.appPath,
      loginPath: def?.loginPath,
      projectServiceId: def?.projectServiceId,
    });
  }
  return existing;
}

function mergeTargetDefs(base, overlay) {
  if (!overlay) return base;
  return {
    ...base,
    ...overlay,
    authProfiles: overlay.authProfiles && Object.keys(overlay.authProfiles).length
      ? overlay.authProfiles
      : (base?.authProfiles || {}),
    roleLandings: overlay.roleLandings && Object.keys(overlay.roleLandings).length
      ? overlay.roleLandings
      : (base?.roleLandings || { default: '/' }),
    apiFixtures: overlay.apiFixtures && Object.keys(overlay.apiFixtures).length
      ? overlay.apiFixtures
      : (base?.apiFixtures || {}),
  };
}

function loadMergedTargets() {
  const map = loadRegistryMap();
  for (const overlay of listPackTargetOverlays()) {
    map[overlay.packKey] = mergeTargetDefs(map[overlay.packKey] || { title: overlay.packKey }, overlay.target);
  }
  for (const [key, def] of Object.entries(dbOverlay)) {
    map[key] = mergeTargetDefs(map[key] || { title: key }, def);
  }
  for (const [key, def] of Object.entries(map)) {
    map[key] = {
      ...def,
      authProfiles: ensureAuthProfiles(def),
      roleLandings: def.roleLandings || { default: '/' },
      apiFixtures: def.apiFixtures || {},
    };
  }
  return map;
}

function warmTargetsFromRows(rows) {
  const next = Object.create(null);
  for (const row of rows || []) {
    const def = rowToDef(row);
    if (def && row.pack_key) next[row.pack_key] = def;
  }
  dbOverlay = next;
  return Object.keys(dbOverlay).length;
}

async function warmTargetsFromDb(pool) {
  if (!pool?.query) return 0;
  const result = await pool.query(
    `SELECT pack_key, title, preferred_origin, login_path, app_path, project_service_id,
            use_origin_host_as_service_id, auth_mode, auth_profiles, role_landings, api_fixtures
       FROM project_targets`,
  );
  return warmTargetsFromRows(result.rows);
}

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function normalizePath(value, fallback = '/') {
  const text = String(value || fallback || '/').trim() || '/';
  return text.startsWith('/') ? text : `/${text}`;
}

function configuredOrigins() {
  const fromEnv = String(process.env.RUNTIME_DEFAULT_ORIGINS || `${DEFAULT_ORIGIN},https://adib.m.edus.ir`)
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  const fromApps = Object.values(loadMergedTargets()).flatMap((item) => {
    const origins = [normalizeOrigin(item.preferredOrigin)];
    for (const profile of Object.values(item.authProfiles || {})) {
      if (profile.authOrigin) origins.push(normalizeOrigin(profile.authOrigin));
      if (profile.appOrigin) origins.push(normalizeOrigin(profile.appOrigin));
    }
    return origins;
  });
  return Array.from(new Set([...fromEnv, ...fromApps, DEFAULT_ORIGIN, 'https://adib.m.edus.ir']));
}

function getAppTarget(projectKey) {
  const key = String(projectKey || '').trim();
  if (!key) return null;
  return loadMergedTargets()[key] || null;
}

function resolveAuthMode(projectKey, overrides = {}) {
  const fromOverride = String(overrides.authMode || '').trim();
  if (fromOverride) return fromOverride;
  const fromEnv = String(process.env.AUTOMATION_RUNTIME_AUTH_MODE || '').trim();
  if (fromEnv) return fromEnv;
  const target = getAppTarget(projectKey);
  return String(target?.authMode || AUTH_MODE_DEVLOGIN);
}

function resolveAuthProfile(projectKey, overrides = {}) {
  const target = getAppTarget(projectKey);
  const authMode = resolveAuthMode(projectKey, overrides);
  const fromTarget = target?.authProfiles?.[authMode] || null;
  if (fromTarget) {
    return {
      ...fromTarget,
      authMode,
      authOrigin: normalizeOrigin(overrides.authOrigin || fromTarget.authOrigin),
      appOrigin: normalizeOrigin(overrides.appOrigin || overrides.origin || fromTarget.appOrigin),
      appPath: normalizePath(overrides.appPath || fromTarget.appPath || '/', fromTarget.appPath || '/'),
      loginPath: fromTarget.loginPath == null
        ? null
        : normalizePath(overrides.loginPath || fromTarget.loginPath, DEFAULT_LOGIN_PATH),
      prostage: overrides.prostage !== undefined ? overrides.prostage : fromTarget.prostage,
      projectServiceId: String(
        overrides.projectServiceId || process.env.AUTOMATION_PROJECT_SERVICE_ID || fromTarget.projectServiceId || '',
      ).trim(),
      handoff: fromTarget.handoff
        ? {
          ...fromTarget.handoff,
          clientAccessId: String(
            overrides.clientAccessId || fromTarget.handoff.clientAccessId || '',
          ).trim(),
        }
        : null,
    };
  }
  if (authMode === AUTH_MODE_SOHA_HANDOFF) {
    const key = String(projectKey || 'app').trim() || 'app';
    return buildSohaHandoffProfile({
      authOrigin: overrides.authOrigin || 'https://soha.medu.ir',
      appOrigin: overrides.appOrigin || overrides.origin || `https://${key}.medu.ir`,
      appPath: overrides.appPath || '/landing',
      projectServiceId: overrides.projectServiceId || target?.projectServiceId || '',
      clientAccessId: overrides.clientAccessId || `${key}_soha`,
      prostage: overrides.prostage,
    });
  }
  const origin = normalizeOrigin(overrides.origin || target?.preferredOrigin || configuredOrigins()[0] || DEFAULT_ORIGIN);
  return buildDevloginProfile({
    preferredOrigin: origin,
    appOrigin: origin,
    loginPath: overrides.loginPath || target?.loginPath || DEFAULT_LOGIN_PATH,
    appPath: overrides.appPath || target?.appPath || '/',
    projectServiceId: overrides.projectServiceId || target?.projectServiceId || '',
  });
}

function resolveAppTarget(projectKey, overrides = {}) {
  const target = getAppTarget(projectKey) || {
    title: keyOrFallback(projectKey),
    preferredOrigin: configuredOrigins()[0] || DEFAULT_ORIGIN,
    loginPath: process.env.RUNTIME_DEFAULT_LOGIN_PATH || DEFAULT_LOGIN_PATH,
    appPath: '/',
    projectServiceId: '',
    useOriginHostAsServiceId: false,
    roleLandings: { default: '/' },
    apiFixtures: {},
    authMode: AUTH_MODE_DEVLOGIN,
  };
  const authProfile = resolveAuthProfile(projectKey, overrides);
  const authMode = authProfile.authMode || AUTH_MODE_DEVLOGIN;
  const origin = normalizeOrigin(
    overrides.origin
    || (authMode === AUTH_MODE_SOHA_HANDOFF ? authProfile.appOrigin : null)
    || target.preferredOrigin
    || authProfile.appOrigin,
  );
  const loginPath = authProfile.loginPath == null
    ? null
    : normalizePath(overrides.loginPath || authProfile.loginPath || target.loginPath || DEFAULT_LOGIN_PATH, DEFAULT_LOGIN_PATH);
  const appPath = normalizePath(overrides.appPath || authProfile.appPath || target.appPath || '/', '/');
  let projectServiceId = String(
    overrides.projectServiceId
    || process.env.AUTOMATION_PROJECT_SERVICE_ID
    || authProfile.projectServiceId
    || target.projectServiceId
    || '',
  ).trim();
  const useOriginHost = Boolean(overrides.useOriginHostAsServiceId ?? target.useOriginHostAsServiceId);
  if (useOriginHost && origin && !overrides.projectServiceId && !String(process.env.AUTOMATION_PROJECT_SERVICE_ID || '').trim()) {
    try { projectServiceId = new URL(origin).host; } catch { /* keep */ }
  } else if (!projectServiceId && useOriginHost && origin) {
    try { projectServiceId = new URL(origin).host; } catch { /* keep */ }
  }
  const authOrigin = normalizeOrigin(authProfile.authOrigin || origin);
  const appOrigin = normalizeOrigin(authProfile.appOrigin || origin);
  const cookieScopes = Array.from(new Set([
    ...(authProfile.cookieScopes || []),
    authOrigin,
    appOrigin,
  ].filter(Boolean)));
  return {
    projectKey: String(projectKey || '') || null,
    title: target.title || String(projectKey || 'runtime'),
    origin,
    loginPath,
    loginUrl: loginPath ? `${authOrigin}${loginPath}` : null,
    appPath,
    appUrl: `${appOrigin}${appPath}`,
    projectServiceId,
    useOriginHostAsServiceId: useOriginHost,
    roleLandings: { ...(target.roleLandings || { default: '/' }) },
    apiFixtures: { ...(target.apiFixtures || {}) },
    preferredOrganPath: String(target.preferredOrganPath || '').trim() || undefined,
    preferredCourseId: String(target.preferredCourseId || '').trim() || undefined,
    authMode,
    authProfile,
    authOrigin,
    appOrigin,
    prostage: authProfile.prostage || null,
    handoff: authProfile.handoff || null,
    readyCheck: authProfile.readyCheck || { ...DEFAULT_READY_CHECK },
    cookieScopes,
    originAllowlist: authProfile.originAllowlist || ['*.m.edus.ir'],
    authModes: Object.keys(target.authProfiles || { [AUTH_MODE_DEVLOGIN]: true }),
  };
}

function keyOrFallback(projectKey) {
  return String(projectKey || 'runtime');
}

function landingPathForRole(projectKey, roleBranch, organLevel) {
  const target = resolveAppTarget(projectKey);
  const branch = String(roleBranch || '');
  const landings = target.roleLandings || {};
  if (branch.includes('camp:app-manager') || branch.includes('app-manager')) {
    const level = Number(organLevel) || 0;
    if (level === 2) return '/camp/setad';
    if (level === 3) return '/camp/ostan';
    if (level === 4) return '/camp/mantaghe';
    return landings['apps.camp.roles.camp:app-manager'] || '/camp/setad';
  }
  for (const [key, pathValue] of Object.entries(landings)) {
    if (key === 'default') continue;
    if (branch.includes(key) || branch === key || branch.endsWith(key.replace(/^apps\.camp\.roles\./, ''))) {
      return pathValue;
    }
  }
  if (branch.includes('roles.admin')) return landings['apps.camp.roles.admin'] || target.appPath;
  if (branch.includes('region-expert')) return landings['apps.camp.roles.camp:region-expert'] || '/camp/mantaghe';
  if (branch.includes('province-expert')) return landings['apps.camp.roles.camp:province-expert'] || '/camp/ostan';
  if (branch.includes('roles.parent')) return landings['roles.parent'] || '/camp/parent';
  return landings.default || target.appPath;
}

function getApiFixture(projectKey, fixtureName) {
  const target = resolveAppTarget(projectKey);
  return target.apiFixtures?.[fixtureName] || null;
}

function buildHandoffUrl(authProfile, { tokenId, handoffUrl } = {}) {
  if (handoffUrl) return String(handoffUrl).trim();
  const handoff = authProfile?.handoff;
  if (!handoff || handoff.type !== 'soha-sso-get-token') return '';
  const id = String(tokenId || '').trim();
  if (!id) return '';
  const path = String(handoff.pathTemplate || '')
    .replaceAll('{tokenId}', encodeURIComponent(id))
    .replaceAll('{clientAccessId}', encodeURIComponent(handoff.clientAccessId || ''));
  return `${normalizeOrigin(authProfile.authOrigin)}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeSourceId(value, { command = false } = {}) {
  const raw = String(value || '').trim().replace(/^\/+/, '');
  if (!raw) return '';
  if (raw.startsWith('ds/') || raw.startsWith('fr/')) return raw;
  // Platform keys (not product api-modules)
  if (raw.startsWith('pages-app/') || raw.startsWith('pwsp--') || raw.startsWith('g/')) return raw;
  return `${command ? 'fr' : 'ds'}/${raw}`;
}

module.exports = {
  get APP_TARGETS() {
    return loadMergedTargets();
  },
  AUTH_MODE_DEVLOGIN,
  AUTH_MODE_SOHA_HANDOFF,
  DEFAULT_ORIGIN,
  DEFAULT_LOGIN_PATH,
  DEFAULT_READY_CHECK,
  buildDevloginProfile,
  buildSohaHandoffProfile,
  configuredOrigins,
  getAppTarget,
  resolveAppTarget,
  resolveAuthMode,
  resolveAuthProfile,
  buildHandoffUrl,
  landingPathForRole,
  getApiFixture,
  normalizeSourceId,
  normalizeOrigin,
  normalizePath,
  warmTargetsFromDb,
  warmTargetsFromRows,
  loadMergedTargets,
};

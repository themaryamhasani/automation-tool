const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_FILE = path.resolve(__dirname, 'targets-registry.json');
const PACKS_ROOT = path.resolve(__dirname, '..', '..', 'runtime', 'packs');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadRegistryMap() {
  const raw = readJson(REGISTRY_FILE);
  return raw && typeof raw === 'object' ? { ...raw } : {};
}

function packTargetFromPackJson(pack) {
  if (!pack || typeof pack !== 'object') return null;
  const nested = pack.target && typeof pack.target === 'object' ? pack.target : {};
  const hasTop = pack.preferredOrigin || pack.projectServiceId || pack.appPath || pack.loginPath
    || pack.authMode || pack.apiFixtures || pack.roleLandings || pack.authProfiles
    || pack.preferredOrganPath || pack.preferredCourseId;
  if (!hasTop && !Object.keys(nested).length) return null;
  return {
    title: nested.title || pack.title || pack.key,
    preferredOrigin: nested.preferredOrigin || pack.preferredOrigin,
    loginPath: nested.loginPath || pack.loginPath,
    appPath: nested.appPath || pack.appPath,
    projectServiceId: nested.projectServiceId ?? pack.projectServiceId,
    useOriginHostAsServiceId: nested.useOriginHostAsServiceId ?? pack.useOriginHostAsServiceId,
    authMode: nested.authMode || pack.authMode,
    authProfiles: nested.authProfiles || pack.authProfiles,
    roleLandings: nested.roleLandings || pack.roleLandings,
    apiFixtures: nested.apiFixtures || pack.apiFixtures,
    preferredOrganPath: nested.preferredOrganPath || pack.preferredOrganPath,
    preferredCourseId: nested.preferredCourseId || pack.preferredCourseId,
  };
}

function listPackTargetOverlays() {
  const out = [];
  if (!fs.existsSync(PACKS_ROOT)) return out;
  for (const approach of fs.readdirSync(PACKS_ROOT, { withFileTypes: true })) {
    if (!approach.isDirectory()) continue;
    const approachRoot = path.join(PACKS_ROOT, approach.name);
    for (const packDir of fs.readdirSync(approachRoot, { withFileTypes: true })) {
      if (!packDir.isDirectory()) continue;
      const packFile = path.join(approachRoot, packDir.name, 'pack.json');
      if (!fs.existsSync(packFile)) continue;
      const pack = readJson(packFile);
      const target = packTargetFromPackJson(pack);
      if (!target) continue;
      out.push({
        packKey: String(pack?.key || packDir.name),
        approach: String(pack?.approach || approach.name).toUpperCase(),
        target,
      });
    }
  }
  return out;
}

function rowToDef(row) {
  if (!row) return null;
  return {
    title: row.title || row.pack_key,
    preferredOrigin: row.preferred_origin || undefined,
    loginPath: row.login_path || undefined,
    appPath: row.app_path || undefined,
    projectServiceId: row.project_service_id || '',
    useOriginHostAsServiceId: Boolean(row.use_origin_host_as_service_id),
    authMode: row.auth_mode || 'devlogin',
    authProfiles: row.auth_profiles || {},
    roleLandings: row.role_landings || { default: '/' },
    apiFixtures: row.api_fixtures || {},
  };
}

module.exports = {
  REGISTRY_FILE,
  PACKS_ROOT,
  loadRegistryMap,
  listPackTargetOverlays,
  packTargetFromPackJson,
  rowToDef,
};

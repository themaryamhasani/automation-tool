const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_NAMES = [
  '.auth/parent.json',
  '.auth/user.json',
  '.auth/storageState.json',
  'storageState.json',
  'parent.json',
];

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function readText(file) {
  return stripBom(fs.readFileSync(file, 'utf8'));
}

function htmlHost(url) {
  try { return new URL(url).hostname || 'localhost'; }
  catch { return 'localhost'; }
}

function resolveExisting(value, searchDirs) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (fs.existsSync(raw) && fs.statSync(raw).isFile()) return path.resolve(raw);
  for (const dir of searchDirs) {
    if (!dir) continue;
    const candidate = path.resolve(dir, raw);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function discoverStorageState(searchDirs) {
  for (const dir of searchDirs.filter(Boolean)) {
    for (const name of STATE_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    const authDir = path.join(dir, '.auth');
    if (!fs.existsSync(authDir) || !fs.statSync(authDir).isDirectory()) continue;
    const json = fs.readdirSync(authDir).find(name => name.endsWith('.json'));
    if (json) return path.join(authDir, json);
  }
  return null;
}

function cookiesFromHeader(header, baseUrl) {
  const host = htmlHost(baseUrl);
  const secure = String(baseUrl || '').startsWith('https');
  return String(header || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(pair => {
      const index = pair.indexOf('=');
      return {
        name: (index === -1 ? pair : pair.slice(0, index)).trim(),
        value: (index === -1 ? '' : pair.slice(index + 1)).trim(),
        domain: host,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure,
        sameSite: 'Lax',
      };
    })
    .filter(item => item.name && item.value);
}

function writeStorageState(dest, { cookies = [], origins = [] } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify({ cookies, origins }, null, 2)}\n`, 'utf8');
  return dest;
}

function storageStateHasCookies(file) {
  if (!file || !fs.existsSync(file)) return false;
  try {
    const data = JSON.parse(readText(file));
    return Array.isArray(data.cookies) && data.cookies.some(item => item && item.name && String(item.value || '').length);
  } catch {
    return false;
  }
}

function preparePlaywrightEnv(env, { searchDirs = [], workspace } = {}) {
  const next = { ...env };
  if (!String(next.E2E_G10_INSTANCE_ID || '').trim() && next.G10_INSTANCE_ID) {
    next.E2E_G10_INSTANCE_ID = String(next.G10_INSTANCE_ID).trim();
  }
  if (!String(next.E2E_MID_INSTANCE_ID || '').trim() && next.MID_INSTANCE_ID) {
    next.E2E_MID_INSTANCE_ID = String(next.MID_INSTANCE_ID).trim();
  }

  const dirs = [
    ...searchDirs,
    next.E2E_STORAGE_STATE_PARENT && path.dirname(String(next.E2E_STORAGE_STATE_PARENT)),
    next.E2E_STORAGE_STATE && path.dirname(String(next.E2E_STORAGE_STATE)),
  ].filter(Boolean);

  let statePath = resolveExisting(next.E2E_STORAGE_STATE_PARENT, dirs)
    || resolveExisting(next.E2E_STORAGE_STATE, dirs)
    || discoverStorageState(dirs);

  const destRoot = workspace && fs.existsSync(workspace) ? workspace : os.tmpdir();
  const cookieHeader = String(next.PREREG_COOKIE || '').trim();
  if ((!statePath || !storageStateHasCookies(statePath)) && cookieHeader) {
    statePath = writeStorageState(path.join(destRoot, 'parent-storage-state.json'), {
      cookies: cookiesFromHeader(cookieHeader, next.E2E_BASE_URL || next.E2E_LOGIN_URL || next.PREREG_BASE_URL || next.BASE_URL || 'http://localhost:5176/'),
    });
  }

  // Rewrite BOM-corrupted auth files into a clean storageState the runner can always load.
  if (statePath && storageStateHasCookies(statePath)) {
    const clean = path.join(destRoot, 'parent-storage-state.json');
    if (path.resolve(statePath) !== path.resolve(clean)) {
      try {
        const data = JSON.parse(readText(statePath));
        statePath = writeStorageState(clean, { cookies: data.cookies || [], origins: data.origins || [] });
      } catch {
        /* keep original */
      }
    }
    next.E2E_STORAGE_STATE_PARENT = statePath;
    next.E2E_STORAGE_STATE = statePath;
  } else if (cookieHeader) {
    statePath = writeStorageState(path.join(destRoot, 'parent-storage-state.json'), {
      cookies: cookiesFromHeader(cookieHeader, next.E2E_BASE_URL || next.E2E_LOGIN_URL || 'http://localhost:5176/'),
    });
    next.E2E_STORAGE_STATE_PARENT = statePath;
    next.E2E_STORAGE_STATE = statePath;
  } else {
    delete next.E2E_STORAGE_STATE_PARENT;
    delete next.E2E_STORAGE_STATE;
  }
  return next;
}

module.exports = {
  preparePlaywrightEnv,
  cookiesFromHeader,
  storageStateHasCookies,
  stripBom,
};

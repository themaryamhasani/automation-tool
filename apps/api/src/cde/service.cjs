const { createHash } = require('node:crypto');
const { decryptText } = require('../../../../shared/snapshot-crypto.cjs');
const {
  CDE_ORIGIN, assertLogicalSuccess, createCdeState, getDataSource, storeFormData,
} = require('./core-client.cjs');
const {
  createLoginChallenge, deleteCdeSession, getCdeSession, readLoginChallenge, setCdeSession,
} = require('./session-store.cjs');

const REPOSITORY_CONFIG = {
  WEB_UI: { column: 'web_ui_repo_name', field: 'webUiRepoName', key: 'cde/repository/web-ui/list/fetch', root: 'web-ui', suffix: 'web-ui' },
  DATA_SERVICE: { column: 'data_service_repo_name', field: 'dataServiceRepoName', key: 'cde/repository/data-service/list/fetch', root: 'data-service', suffix: 'data-service' },
  API_MODULE: { column: 'api_module_repo_name', field: 'apiModuleRepoName', key: 'cde/repository/api-module/list/fetch', root: 'api-module', suffix: 'api-module' },
  MESSAGE_CONSUMER: { column: 'message_consumer_repo_name', field: 'messageConsumerRepoName', key: 'cde/repository/message-consumer/list/fetch', root: 'message-consumer', suffix: 'message-consumer' },
};
const BROWSABLE_TYPES = Object.keys(REPOSITORY_CONFIG);
const BUNDLE_TYPES = ['WEB_UI', 'DATA_SERVICE', 'API_MODULE'];

class CdeError extends Error {
  constructor(code, message, status = 400, details) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function resultOf(response) { return response?.Result && typeof response.Result === 'object' ? response.Result : {}; }
function itemsOf(response) {
  const items = resultOf(response).items;
  if (!Array.isArray(items)) throw new CdeError('CDE_SCHEMA_ERROR', 'پاسخ CDE شامل آرایه items نبود.', 502);
  return items;
}
function displayUser(user) {
  if (!user || typeof user !== 'object') return null;
  return { firstName: String(user.firstName || ''), lastName: String(user.lastName || ''), displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() };
}
function normalizeLogin(value) {
  const digits = String(value || '').trim().replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s()-]/g, '');
  const local = digits.replace(/^\+98/, '').replace(/^0098/, '').replace(/^98/, '').replace(/^0(?=9)/, '');
  return /^9\d{9}$/.test(local) ? local : '';
}
function normalizeProjectKey(value) {
  const key = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(key)) throw new CdeError('CDE_PROJECT_INVALID', 'کلید پروژه CDE معتبر نیست.', 422);
  return key;
}
function normalizeSourcePath(value) {
  const sourcePath = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!sourcePath || sourcePath.includes('\0') || sourcePath.startsWith('/') || /^[a-zA-Z]:/.test(sourcePath)) throw new CdeError('CDE_UNSAFE_PATH', 'مسیر سورس معتبر نیست.', 422);
  const parts = sourcePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new CdeError('CDE_UNSAFE_PATH', 'مسیر سورس شامل بخش ناامن است.', 422);
  return parts.join('/');
}
function repoName(projectKey, type) {
  const config = REPOSITORY_CONFIG[type];
  if (!config) throw new CdeError('CDE_REPOSITORY_TYPE_INVALID', 'نوع Repository معتبر نیست.', 422);
  return `${normalizeProjectKey(projectKey)}/${config.suffix}`;
}
function descriptor(projectKey) {
  const key = normalizeProjectKey(projectKey); const encoded = encodeURIComponent(key); const encodedApp = encodeURIComponent(`${key}>App`); const encodedGateway = encodeURIComponent(`${key}>`);
  return {
    projectKey: key,
    repositories: Object.fromEntries(BROWSABLE_TYPES.map(type => [type, repoName(key, type)])),
    editorUrls: {
      webUi: `${CDE_ORIGIN}/front/directory/${encodedApp}`,
      dataService: `${CDE_ORIGIN}/dservice/directory/${encodedApp}`,
      gateway: `${CDE_ORIGIN}/back/${encoded}/${encodedGateway}?return=/workspace/${encoded}`,
    },
  };
}
function branchesOf(item, repositoryType) {
  const rows = [];
  if (item?.public && typeof item.public === 'object' && Object.keys(item.public).length) rows.push({ selector: { kind: 'PUBLIC' }, versionId: item.public.versionId || null, editable: false, meta: item.public.meta || {}, value: item.public });
  (Array.isArray(item?.personal) ? item.personal : []).forEach((branch, index) => rows.push({
    selector: { kind: 'PERSONAL', ...(branch.rand_id ? { randId: String(branch.rand_id) } : {}), index: Number.isInteger(branch.index) ? branch.index : index },
    versionId: branch.versionId || null, editable: branch.editable === true, meta: branch.meta || {}, value: branch,
  }));
  return rows.map(row => ({ ...row, repositoryType }));
}
function branchSummary(branch) { return { selector: branch.selector, versionId: branch.versionId, editable: branch.editable, meta: branch.meta }; }
function selectorMatches(branch, selector) {
  if (!selector || selector.kind !== branch.selector.kind) return false;
  if (selector.kind === 'PUBLIC') return true;
  return selector.randId ? selector.randId === branch.selector.randId : Number.isInteger(selector.index) && selector.index === branch.selector.index;
}
function packageSummary(item, type) { return { id: String(item?.id || item?._id || ''), branches: branchesOf(item, type).map(branchSummary) }; }
function packagesOf(response, type) { return itemsOf(response).map(item => typeof item === 'string' ? { id: item, branches: [] } : packageSummary(item, type)); }
function normalizeFiles(branch, type, packId) {
  if (type === 'API_MODULE') return [{ path: `${String(packId).replace(/^ds\//, '')}.js`, code: String(branch.value.actions || ''), language: 'javascript', readOnly: true }];
  const files = branch.value?.content?.content;
  if (!Array.isArray(files)) throw new CdeError('CDE_SCHEMA_ERROR', 'شاخه انتخاب‌شده آرایه فایل سورس ندارد.', 502);
  const seen = new Set();
  return files.map(file => {
    const path = normalizeSourcePath(file.name); const folded = path.toLocaleLowerCase('en-US');
    if (seen.has(folded)) throw new CdeError('CDE_PATH_COLLISION', 'مسیر فایل‌های CDE تکراری است.', 422);
    seen.add(folded); return { path, code: String(file.code ?? ''), readOnly: true };
  });
}
function sourceRoot(type) { return REPOSITORY_CONFIG[type]?.root || String(type).toLowerCase(); }
function branchLabel(branch, ordinal = null) {
  if (ordinal == null) {
    if (branch.selector.kind === 'PUBLIC') return 'public';
    const identity = String(branch.selector.randId ?? branch.selector.index ?? 'unknown').replace(/[^a-zA-Z0-9._-]/g, '-') || 'unknown';
    return `personal-${identity}`;
  }
  const prefix = `${String(ordinal + 1).padStart(3, '0')}-`;
  if (branch.selector.kind === 'PUBLIC') return `${prefix}public`;
  return `${prefix}personal-${Number.isInteger(branch.selector.index) ? branch.selector.index : 'unknown'}-${branch.selector.randId ? encodeURIComponent(String(branch.selector.randId)) : 'no-id'}`;
}
function bundlePath(type, packId, branch, file, ordinal) {
  const pack = encodeURIComponent(normalizeSourcePath(packId));
  return normalizeSourcePath(`${sourceRoot(type)}/packages/${pack}/branches/${branchLabel(branch, ordinal)}/${type === 'API_MODULE' ? 'actions.js' : file.path}`);
}
function uniquePath(value, paths) {
  const normalized = normalizeSourcePath(value); const folded = normalized.toLocaleLowerCase('en-US');
  if (!paths.has(folded)) { paths.add(folded); return normalized; }
  const slash = normalized.lastIndexOf('/'); const dot = normalized.lastIndexOf('.'); const extension = dot > slash ? normalized.slice(dot) : ''; const stem = extension ? normalized.slice(0, dot) : normalized;
  for (let n = 2; n < 10_000; n += 1) { const candidate = `${stem}.duplicate-${n}${extension}`; if (!paths.has(candidate.toLocaleLowerCase('en-US'))) { paths.add(candidate.toLocaleLowerCase('en-US')); return candidate; } }
  throw new CdeError('CDE_PATH_COLLISION', `تداخل بیش از حد مسیر دانلود: ${normalized}`, 422);
}
function recoverable(error) { return ['CDE_LOGICAL_ERROR', 'CDE_SCHEMA_ERROR', 'CDE_PACKAGE_NOT_FOUND', 'CDE_PACKAGE_BRANCH_NOT_FOUND', 'CDE_UNSAFE_PATH', 'CDE_PATH_COLLISION'].includes(error?.code) || (error?.code === 'CDE_HTTP_ERROR' && /404/.test(error.message)); }
function serializeMapping(row) {
  return { id: row.id, projectId: row.project_id, serviceId: row.service_id, projectKey: row.project_key, webUiRepoName: row.web_ui_repo_name, dataServiceRepoName: row.data_service_repo_name, apiModuleRepoName: row.api_module_repo_name, messageConsumerRepoName: row.message_consumer_repo_name, testRepoName: row.test_repo_name, testPackId: row.test_pack_id, enabled: row.enabled, lastValidationStatus: row.last_validation_status, lastValidatedAt: row.last_validated_at };
}
function isTestFileName(name) {
  const value = String(name || '');
  return /\.(spec|test)\.(ts|tsx|js|mjs|cjs)$/i.test(value)
    || (/(^|\/)k6[^/]*\.js$/i.test(value))
    || /(?:^|\/)(?:playwright|vitest)\.config\.(ts|js|mjs|cjs)$/i.test(value);
}
function isTestPackId(id) {
  return /(^|\/)(tests?|e2e|playwright|cypress|__tests__|specs?|k6|vitest|qa|smoke)(\/|$)/i.test(String(id || ''));
}
function nestFileTree(files) {
  const root = { children: [], dirs: new Map() };
  for (const file of files) {
    const parts = String(file.path || '').split('/').filter(Boolean);
    if (!parts.length) continue;
    const name = file.name || parts[parts.length - 1];
    let node = root;
    let acc = [];
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      acc.push(part);
      if (!node.dirs.has(part)) {
        const child = { name: part, path: acc.join('/'), type: 'dir', children: [], dirs: new Map() };
        node.children.push(child);
        node.dirs.set(part, child);
      }
      node = node.dirs.get(part);
    }
    node.children.push({ name, path: file.path, type: 'file' });
  }
  const strip = node => node.children.map(child => (child.type === 'dir'
    ? { name: child.name, path: child.path, type: 'dir', children: strip(child) }
    : { name: child.name, path: child.path, type: 'file' }));
  return strip(root);
}

function registerCdeRoutes(app, { pool, audit, ensureProjectAccess }) {
  async function saveState(req, callResult, ttl) { await setCdeSession(pool, req.user.sessionId, callResult.state, ttl); return callResult.response; }
  async function state(req) {
    const value = await getCdeSession(pool, req.user.sessionId);
    if (!value) throw new CdeError('CDE_NOT_CONNECTED', 'ابتدا حساب CDE را متصل کنید.', 401);
    return value;
  }
  async function call(req, key, params = {}, suppliedState) {
    const current = suppliedState || await state(req);
    const response = await saveState(req, await getDataSource(current, key, params));
    assertLogicalSuccess(response);
    if (resultOf(response).IsUserLogin === false) {
      await deleteCdeSession(pool, req.user.sessionId);
      throw new CdeError('CDE_RECONNECT_REQUIRED', 'نشست CDE منقضی شده است؛ دوباره متصل شوید.', 401);
    }
    return response;
  }
  async function accessible(req, force = false) {
    const current = await state(req);
    if (!force && Array.isArray(current.accessibleProjects) && Date.now() - Number(current.accessibleProjectsAt || 0) < 60_000) return current.accessibleProjects;
    const response = await call(req, 'cde/repository/list/my-repo', {}, current);
    const projects = [...new Set(itemsOf(response).map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean))];
    const refreshed = await state(req); refreshed.accessibleProjects = projects; refreshed.accessibleProjectsAt = Date.now();
    await setCdeSession(pool, req.user.sessionId, refreshed); return projects;
  }
  async function assertAccessible(req, projectKey) {
    const key = normalizeProjectKey(projectKey);
    if (!(await accessible(req)).includes(key)) throw new CdeError('CDE_PROJECT_ACCESS_DENIED', 'حساب متصل‌شده به این پروژه CDE دسترسی ندارد.', 403);
    return key;
  }
  async function mapping(projectId, required = true) {
    const result = await pool.query('SELECT * FROM cde_project_mappings WHERE project_id=$1', [projectId]);
    if (!result.rowCount && required) throw new CdeError('CDE_MAPPING_NOT_FOUND', 'این پروژه Mapping فعال CDE ندارد.', 404);
    return result.rows[0] || null;
  }
  async function optionalMapped(req, projectId) {
    if (!projectId) return null;
    await ensureProjectAccess(req.user, projectId);
    const row = await mapping(projectId, false);
    if (!row || !row.enabled) return null;
    await assertAccessible(req, row.project_key);
    return row;
  }
  async function mappedAndAccessible(req, projectId) {
    await ensureProjectAccess(req.user, projectId);
    const row = await mapping(projectId);
    if (!row.enabled) throw new CdeError('CDE_MAPPING_DISABLED', 'Mapping این پروژه غیرفعال است.', 409);
    await assertAccessible(req, row.project_key); return row;
  }
  async function loadPackage(req, projectKey, type, packId, mappedRow = null) {
    const config = REPOSITORY_CONFIG[type]; const name = mappedRow?.[config?.column] || repoName(projectKey, type);
    const list = await call(req, config.key, { repoName: name });
    const listed = itemsOf(list).find(item => String(item?.id || item?._id || item || '') === packId);
    if (!listed) throw new CdeError('CDE_PACKAGE_NOT_FOUND', 'پکیج در Repository انتخاب‌شده پیدا نشد.', 404);
    if (type === 'API_MODULE') return { item: listed, repoName: name };
    const response = await call(req, 'cde/package/any/one/fetch', { repoName: name, packId });
    const item = resultOf(response).pack;
    if (!item || typeof item !== 'object') throw new CdeError('CDE_PACKAGE_NOT_FOUND', 'پکیج CDE پیدا نشد.', 404);
    return { item, repoName: name };
  }
  async function resolveRemembered(req, projectId, type, name, packId, item, requested) {
    let selector = requested;
    if (!selector && projectId) {
      const saved = await pool.query('SELECT * FROM cde_branch_selections WHERE user_id=$1 AND project_id=$2 AND repository_type=$3 AND repo_name=$4 AND pack_id=$5', [req.user.id, projectId, type, name, packId]);
      if (saved.rowCount) selector = saved.rows[0].branch_kind === 'PUBLIC' ? { kind: 'PUBLIC' } : { kind: 'PERSONAL', ...(saved.rows[0].branch_rand_id ? { randId: saved.rows[0].branch_rand_id } : {}), ...(Number.isInteger(saved.rows[0].branch_index) ? { index: saved.rows[0].branch_index } : {}) };
    }
    const branches = branchesOf(item, type); let selected = selector ? branches.find(branch => selectorMatches(branch, selector)) : null;
    if (!selected && branches.length === 1) selected = branches[0];
    if (!selected) throw new CdeError('BRANCH_SELECTION_REQUIRED', 'یکی از شاخه‌های قابل دسترس را انتخاب کنید.', 409, { branches: branches.map(branchSummary) });
    return { branches, selected };
  }

  app.get('/api/cde/session', asyncRoute(async (req, res) => {
    const current = await getCdeSession(pool, req.user.sessionId);
    if (!current) return res.json({ connected: false });
    if (String(req.query.verify || '') !== 'true') {
      return res.json({ connected: true });
    }
    try {
      const response = await saveState(req, await getDataSource(current, 'pages-app/who-am-i', {})); const result = resultOf(response);
      if (!result.IsUserLogin) { await deleteCdeSession(pool, req.user.sessionId); return res.json({ connected: false, reconnectRequired: true }); }
      res.json({ connected: true, user: displayUser(result.LoginUser), ecreq: Boolean(result.ecreq) });
    } catch (error) {
      if (['CDE_RECONNECT_REQUIRED', 'CDE_SESSION_INVALID'].includes(error.code)) return res.json({ connected: false, reconnectRequired: true });
      if (['CDE_UNAVAILABLE', 'CDE_TIMEOUT', 'CDE_HTTP_ERROR'].includes(error.code)) {
        return res.json({ connected: false, unavailable: true, message: error.message });
      }
      throw error;
    }
  }));
  app.post('/api/cde/session/start', asyncRoute(async (req, res) => {
    const loginName = normalizeLogin(req.body?.userLoginName);
    if (!loginName) throw new CdeError('CDE_LOGIN_NAME_INVALID', 'شماره همراه معتبر وارد کنید.', 422);
    await deleteCdeSession(pool, req.user.sessionId);
    let current = createCdeState(); let result = await getDataSource(current, 'pages-app/who-am-i', {}); current = result.state;
    if (resultOf(result.response).IsUserLogin) { await setCdeSession(pool, req.user.sessionId, current); return res.json({ connected: true, user: displayUser(resultOf(result.response).LoginUser) }); }
    result = await storeFormData(current, 'auth/signin/iran-cellphone', { userSource: 'rayadevelopers', userLoginName: loginName });
    assertLogicalSuccess(result.response); const loginResult = resultOf(result.response);
    if (loginResult.IsUserLogin) { await setCdeSession(pool, req.user.sessionId, result.state); return res.json({ connected: true, user: displayUser(loginResult.LoginUser), ecreq: Boolean(loginResult.ecreq) }); }
    if (String(loginResult.nextStep || '').trim().toLowerCase() !== 'password') throw new CdeError('CDE_ACCOUNT_NOT_FOUND', 'حساب CDE با این شماره پیدا نشد.', 404);
    await setCdeSession(pool, req.user.sessionId, result.state, 300);
    res.json({ connected: false, nextStep: 'password', challenge: createLoginChallenge(req.user.sessionId, loginName) });
  }));
  app.post('/api/cde/session/password', asyncRoute(async (req, res) => {
    const password = String(req.body?.password || '');
    if (!password || !req.body?.challenge) throw new CdeError('CDE_PASSWORD_REQUIRED', 'رمز عبور و challenge الزامی است.', 422);
    let loginName;
    try { loginName = readLoginChallenge(req.user.sessionId, String(req.body.challenge)); }
    catch { throw new CdeError('CDE_LOGIN_CHALLENGE_EXPIRED', 'زمان ورود تمام شده است؛ دوباره شروع کنید.', 401); }
    let result = await storeFormData(await state(req), 'auth/signin/check-password', { userSource: 'rayadevelopers', userLoginName: loginName, contact: 'iran-cellphone', password });
    try { assertLogicalSuccess(result.response); } catch { await setCdeSession(pool, req.user.sessionId, result.state, 300); throw new CdeError('CDE_INVALID_CREDENTIALS', 'رمز عبور CDE نادرست است.', 401); }
    result = await getDataSource(result.state, 'pages-app/who-am-i', {}); const value = resultOf(result.response);
    if (!value.IsUserLogin) { await setCdeSession(pool, req.user.sessionId, result.state, 300); throw new CdeError('CDE_INVALID_CREDENTIALS', 'رمز عبور CDE نادرست است.', 401); }
    await setCdeSession(pool, req.user.sessionId, result.state); await audit(pool, req.user.id, 'CDE_CONNECTED', 'USER', req.user.id);
    res.json({ connected: true, user: displayUser(value.LoginUser), ecreq: Boolean(value.ecreq) });
  }));
  app.delete('/api/cde/session', asyncRoute(async (req, res) => { await deleteCdeSession(pool, req.user.sessionId); await audit(pool, req.user.id, 'CDE_DISCONNECTED', 'USER', req.user.id); res.json({ connected: false }); }));
  app.get('/api/cde/projects', asyncRoute(async (req, res) => res.json((await accessible(req, req.query.refresh === 'true')).map(descriptor))));

  app.get('/api/cde/projects/:projectKey/catalog', asyncRoute(async (req, res) => {
    const key = await assertAccessible(req, req.params.projectKey);
    const mappedRow = req.query.projectId ? await optionalMapped(req, String(req.query.projectId)) : null;
    if (mappedRow && mappedRow.project_key !== key) throw new CdeError('CDE_PROJECT_MAPPING_MISMATCH', 'پروژه انتخاب‌شده با Mapping محلی یکسان نیست.', 409);
    const repositories = [];
    for (const type of BROWSABLE_TYPES) {
      const config = REPOSITORY_CONFIG[type]; const name = mappedRow?.[config.column] || repoName(key, type);
      if (!name) continue;
      try {
        const packages = packagesOf(await call(req, config.key, { repoName: name }), type);
        if (type === 'DATA_SERVICE' && !packages.length) continue;
        repositories.push({ type, repoName: name, packages });
      } catch (error) {
        if (['CDE_NOT_CONNECTED', 'CDE_RECONNECT_REQUIRED'].includes(error.code)) throw error;
        if (type === 'DATA_SERVICE' && recoverable(error)) continue;
        repositories.push({ type, repoName: name, packages: [], error: { code: error.code || 'CDE_REPOSITORY_LOAD_FAILED', message: error.message } });
      }
    }
    res.json({ projectKey: key, approach: repositories.some(row => row.type === 'DATA_SERVICE') ? 'DATA_SERVICE' : 'GATEWAY', repositories });
  }));
  app.get('/api/cde/projects/:projectKey/test-files', asyncRoute(async (req, res) => {
    const key = await assertAccessible(req, req.params.projectKey);
    const mappedRow = req.query.projectId ? await optionalMapped(req, String(req.query.projectId)) : null;
    if (mappedRow && mappedRow.project_key !== key) throw new CdeError('CDE_PROJECT_MAPPING_MISMATCH', 'پروژه انتخاب‌شده با Mapping محلی یکسان نیست.', 409);
    const entries = [];

    const dbTests = await pool.query(
      `SELECT id, folder_path, file_name FROM test_files
        WHERE cde_project_key=$1 OR project_id IN (SELECT project_id FROM cde_project_mappings WHERE project_key=$1)
        ORDER BY folder_path, file_name`,
      [key],
    );
    if (dbTests.rowCount) {
      entries.push({
        name: 'tests · CDE/DB',
        path: 'cde-db-tests',
        type: 'dir',
        children: nestFileTree(dbTests.rows.map(row => ({
          name: row.file_name,
          path: `cde-db-tests/${row.id}/${String(row.folder_path || 'tests').replace(/^\/+|\/+$/g, '')}/${row.file_name}`.replace(/\/+/g, '/'),
        }))),
      });
    }

    const snapshot = await pool.query(
      `SELECT id FROM cde_source_snapshots
        WHERE status='READY' AND file_count>0 AND expires_at>now()
          AND manifest->>'projectKey'=$1
        ORDER BY updated_at DESC LIMIT 1`,
      [key],
    );
    if (snapshot.rowCount) {
      const files = await pool.query(
        `SELECT path, repository_type FROM cde_snapshot_files WHERE snapshot_id=$1 ORDER BY path`,
        [snapshot.rows[0].id],
      );
      const testFiles = files.rows.filter(file => file.repository_type === 'TESTS' || isTestFileName(file.path));
      if (testFiles.length) {
        entries.push({
          name: 'tests · Snapshot CDE',
          path: 'cde-snapshot',
          type: 'dir',
          children: nestFileTree(testFiles.map(file => ({
            name: file.path.split('/').pop(),
            path: `cde-snapshot/${file.path}`,
          }))),
        });
      }
    }

    for (const type of BROWSABLE_TYPES) {
      const config = REPOSITORY_CONFIG[type];
      const name = mappedRow?.[config.column] || repoName(key, type);
      if (!name) continue;
      let packages = [];
      try { packages = packagesOf(await call(req, config.key, { repoName: name }), type); }
      catch (error) {
        if (['CDE_NOT_CONNECTED', 'CDE_RECONNECT_REQUIRED'].includes(error.code)) throw error;
        continue;
      }
      const children = [];
      for (const pack of packages) {
        const packId = String(pack.id || '');
        if (!packId || !isTestPackId(packId)) continue;
        let files = [];
        try {
          const loaded = await loadPackage(req, key, type, packId, mappedRow);
          const branches = branchesOf(loaded.item, type);
          const selected = branches.find(branch => branch.selector.kind === 'PUBLIC') || branches[0];
          if (selected) files = normalizeFiles(selected, type, packId);
        } catch { files = []; }
        const testFiles = files.filter(file => isTestFileName(file.path));
        const listed = testFiles.length ? testFiles : files;
        if (!listed.length) continue;
        const encoded = encodeURIComponent(packId);
        children.push({
          name: packId,
          path: `cde-tests/${type}/${encoded}`,
          type: 'dir',
          children: nestFileTree(listed.map(file => ({
            name: file.path.split('/').pop(),
            path: `cde-tests/${type}/${encoded}/${file.path}`,
          }))),
        });
      }
      if (children.length) entries.push({ name: `${type} · CDE`, path: `cde-tests/${type}`, type: 'dir', children });
    }
    res.json({ projectKey: key, entries });
  }));
  app.get('/api/cde/projects/:projectKey/test-file', asyncRoute(async (req, res) => {
    const key = await assertAccessible(req, req.params.projectKey);
    const selected = String(req.query.path || '').replace(/\\/g, '/');
    if (!selected) throw new CdeError('CDE_UNSAFE_PATH', 'مسیر فایل تست معتبر نیست.', 422);
    if (selected.startsWith('cde-db-tests/')) {
      const id = selected.split('/')[1];
      const row = await pool.query('SELECT id, folder_path, file_name, source_code FROM test_files WHERE id=$1', [id]);
      if (!row.rowCount) throw new CdeError('CDE_PACKAGE_NOT_FOUND', 'فایل تست CDE پیدا نشد.', 404);
      const file = row.rows[0];
      return res.json({ path: selected, name: file.file_name, code: file.source_code || '' });
    }
    if (selected.startsWith('cde-snapshot/')) {
      const sourcePath = selected.slice('cde-snapshot/'.length);
      const snapshot = await pool.query(
        `SELECT id FROM cde_source_snapshots
          WHERE status='READY' AND file_count>0 AND expires_at>now()
            AND manifest->>'projectKey'=$1
          ORDER BY updated_at DESC LIMIT 1`,
        [key],
      );
      if (!snapshot.rowCount) throw new CdeError('CDE_PACKAGE_NOT_FOUND', 'Snapshot آماده برای این پروژه نیست.', 404);
      const file = await pool.query(
        'SELECT path, encrypted_source FROM cde_snapshot_files WHERE snapshot_id=$1 AND path=$2',
        [snapshot.rows[0].id, sourcePath],
      );
      if (!file.rowCount) throw new CdeError('CDE_PACKAGE_NOT_FOUND', 'فایل تست در Snapshot پیدا نشد.', 404);
      return res.json({ path: selected, name: sourcePath.split('/').pop(), code: decryptText(file.rows[0].encrypted_source) });
    }
    const match = selected.match(/^cde-tests\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) throw new CdeError('CDE_UNSAFE_PATH', 'مسیر فایل تست CDE معتبر نیست.', 422);
    const type = match[1];
    const packId = decodeURIComponent(match[2]);
    const filePath = match[3];
    if (!BROWSABLE_TYPES.includes(type)) throw new CdeError('CDE_REPOSITORY_TYPE_INVALID', 'نوع Repository قابل مرور نیست.', 422);
    const mappedRow = req.query.projectId ? await optionalMapped(req, String(req.query.projectId)) : null;
    const loaded = await loadPackage(req, key, type, packId, mappedRow);
    const branches = branchesOf(loaded.item, type);
    const selectedBranch = branches.find(branch => branch.selector.kind === 'PUBLIC') || branches[0];
    if (!selectedBranch) throw new CdeError('CDE_PACKAGE_BRANCH_NOT_FOUND', 'شاخه پکیج CDE پیدا نشد.', 404);
    const files = normalizeFiles(selectedBranch, type, packId);
    const file = files.find(item => item.path === filePath || item.path.endsWith(filePath));
    if (!file) throw new CdeError('CDE_PACKAGE_NOT_FOUND', 'فایل تست در پکیج CDE پیدا نشد.', 404);
    res.json({ path: selected, name: file.path.split('/').pop(), code: file.code || '' });
  }));
  app.post('/api/cde/projects/:projectKey/package', asyncRoute(async (req, res) => {
    const key = await assertAccessible(req, req.params.projectKey); const type = String(req.body?.repositoryType || '');
    if (!BROWSABLE_TYPES.includes(type)) throw new CdeError('CDE_REPOSITORY_TYPE_INVALID', 'نوع Repository قابل مرور نیست.', 422);
    const mappedRow = req.body?.projectId ? await optionalMapped(req, String(req.body.projectId)) : null;
    if (mappedRow && mappedRow.project_key !== key) throw new CdeError('CDE_PROJECT_MAPPING_MISMATCH', 'پروژه انتخاب‌شده با Mapping محلی یکسان نیست.', 409);
    const packId = String(req.body?.packId || ''); const loaded = await loadPackage(req, key, type, packId, mappedRow);
    const resolved = await resolveRemembered(
      req,
      req.body?.selectBranch ? null : (req.body?.projectId || null),
      type,
      loaded.repoName,
      packId,
      loaded.item,
      req.body?.branch || null,
    );
    if (req.body?.selectBranch && !req.body?.branch) {
      throw new CdeError('BRANCH_SELECTION_REQUIRED', 'یکی از شاخه‌های قابل دسترس را انتخاب کنید.', 409, {
        branches: resolved.branches.map(branchSummary),
      });
    }
    res.json({ projectKey: key, repositoryType: type, repoName: loaded.repoName, packId, branches: resolved.branches.map(branchSummary), branch: branchSummary(resolved.selected), files: normalizeFiles(resolved.selected, type, packId) });
  }));
  app.get('/api/cde/projects/:projectKey/bundle', asyncRoute(async (req, res) => {
    const key = await assertAccessible(req, req.params.projectKey);
    const mappedRow = req.query.projectId ? await optionalMapped(req, String(req.query.projectId)) : null;
    if (mappedRow && mappedRow.project_key !== key) throw new CdeError('CDE_PROJECT_MAPPING_MISMATCH', 'پروژه انتخاب‌شده با Mapping محلی یکسان نیست.', 409);
    const files = []; const packages = []; const warnings = []; const paths = new Set(); const included = [];
    for (const type of BUNDLE_TYPES) {
      const config = REPOSITORY_CONFIG[type]; const name = mappedRow?.[config.column] || repoName(key, type); let items;
      try { items = itemsOf(await call(req, config.key, { repoName: name })); }
      catch (error) { if (type === 'DATA_SERVICE' && recoverable(error)) continue; if (recoverable(error)) { warnings.push({ code: error.code, message: error.message, repositoryType: type, repoName: name, packId: '' }); continue; } throw error; }
      if (type === 'DATA_SERVICE' && !items.length) continue; included.push(type);
      for (const listed of items) {
        const packId = String(listed?.id || listed?._id || listed || ''); if (!packId) { warnings.push({ code: 'CDE_PACKAGE_ID_MISSING', repositoryType: type, repoName: name, packId: '' }); continue; }
        let item = listed;
        if (type !== 'API_MODULE') {
          try { item = resultOf(await call(req, 'cde/package/any/one/fetch', { repoName: name, packId })).pack; }
          catch (error) { if (!recoverable(error)) throw error; warnings.push({ code: error.code, message: error.message, repositoryType: type, repoName: name, packId }); continue; }
        }
        if (!item || typeof item !== 'object') { warnings.push({ code: 'CDE_PACKAGE_NOT_FOUND', repositoryType: type, repoName: name, packId }); continue; }
        const branches = branchesOf(item, type);
        if (!branches.length) { warnings.push({ code: 'CDE_PACKAGE_BRANCH_NOT_FOUND', repositoryType: type, repoName: name, packId }); continue; }
        for (const [ordinal, branch] of branches.entries()) {
          try {
            const sourceFiles = normalizeFiles(branch, type, packId); const manifestFiles = sourceFiles.map(file => {
              const path = uniquePath(bundlePath(type, packId, branch, file, ordinal), paths); const sourceHash = hash(file.code);
              files.push({ path, code: file.code, sourceHash, repositoryType: type, repoName: name, packId, selector: branch.selector, versionId: branch.versionId });
              return { path, sourceHash };
            });
            packages.push({ repositoryType: type, repoName: name, packId, selector: branch.selector, versionId: branch.versionId, files: manifestFiles });
          } catch (error) { if (!recoverable(error)) throw error; warnings.push({ code: error.code, message: error.message, repositoryType: type, repoName: name, packId, selector: branch.selector }); }
        }
      }
    }
    if (!files.length) throw new CdeError('CDE_PROJECT_SOURCE_EMPTY', 'برای این پروژه سورس قابل دانلودی پیدا نشد.', 404, { warnings });
    files.sort((a, b) => a.path.localeCompare(b.path)); packages.sort((a, b) => a.repositoryType.localeCompare(b.repositoryType) || a.packId.localeCompare(b.packId));
    res.json({ format: 1, projectKey: key, approach: included.includes('DATA_SERVICE') ? 'DATA_SERVICE' : 'GATEWAY', fileName: `${key}-app-source.zip`, generatedAt: new Date().toISOString(), repositoryTypes: included, packages, warnings, files });
  }));

  app.get('/api/projects/:projectId/cde-mapping', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId); const row = await mapping(req.params.projectId, false);
    if (!row) return res.status(404).json({ code: 'CDE_MAPPING_NOT_FOUND', message: 'Mapping برای پروژه ثبت نشده است.' });
    res.json(serializeMapping(row));
  }));
  app.put('/api/projects/:projectId/cde-mapping', asyncRoute(async (req, res) => {
    if (req.user.role !== 'ADMIN') throw new CdeError('ADMIN_REQUIRED', 'فقط مدیر سیستم می‌تواند Mapping را تغییر دهد.', 403);
    await ensureProjectAccess(req.user, req.params.projectId, true); const key = normalizeProjectKey(req.body?.projectKey);
    const validateRepo = (value, suffix, optional = false) => { const text = String(value || '').trim(); if (!text && optional) return null; const effective = text || `${key}/${suffix}`; if (!effective.endsWith(`/${suffix}`) || effective.includes('..')) throw new CdeError('CDE_MAPPING_INVALID', `Repository باید به /${suffix} ختم شود.`, 422); return effective; };
    const values = [req.params.projectId, key, validateRepo(req.body?.webUiRepoName, 'web-ui'), validateRepo(req.body?.dataServiceRepoName, 'data-service'), validateRepo(req.body?.apiModuleRepoName, 'api-module'), validateRepo(req.body?.messageConsumerRepoName, 'message-consumer', true), 'automation_tool_test_files', `playwright/${key}`, req.body?.enabled !== false];
    const saved = await pool.query(
      `INSERT INTO cde_project_mappings (project_id,project_key,web_ui_repo_name,data_service_repo_name,api_module_repo_name,message_consumer_repo_name,test_repo_name,test_pack_id,enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (project_id) DO UPDATE SET project_key=excluded.project_key,web_ui_repo_name=excluded.web_ui_repo_name,data_service_repo_name=excluded.data_service_repo_name,api_module_repo_name=excluded.api_module_repo_name,message_consumer_repo_name=excluded.message_consumer_repo_name,test_repo_name=excluded.test_repo_name,test_pack_id=excluded.test_pack_id,enabled=excluded.enabled,updated_at=now() RETURNING *`, values,
    );
    await audit(pool, req.user.id, 'CDE_MAPPING_SAVED', 'PROJECT', req.params.projectId, { projectKey: key }); res.json(serializeMapping(saved.rows[0]));
  }));
  app.post('/api/projects/:projectId/cde-mapping/validate', asyncRoute(async (req, res) => {
    if (req.user.role !== 'ADMIN') throw new CdeError('ADMIN_REQUIRED', 'دسترسی مدیر سیستم لازم است.', 403);
    const row = await mappedAndAccessible(req, req.params.projectId); let status = 'HEALTHY'; const checks = [];
    try {
      for (const type of BROWSABLE_TYPES) {
        const config = REPOSITORY_CONFIG[type]; const name = row[config.column];
        if (!name) { checks.push({ repositoryType: type, status: 'SKIPPED' }); continue; }
        try {
          const response = await call(req, config.key, { repoName: name });
          checks.push({ repositoryType: type, repoName: name, status: 'HEALTHY', packageCount: itemsOf(response).length });
        } catch (error) {
          if (type === 'DATA_SERVICE' && recoverable(error)) { checks.push({ repositoryType: type, repoName: name, status: 'OPTIONAL_UNAVAILABLE', code: error.code }); continue; }
          throw error;
        }
      }
    } catch (error) { status = error.code || 'FAILED'; await pool.query('UPDATE cde_project_mappings SET last_validation_status=$1,last_validated_at=now() WHERE project_id=$2', [status, req.params.projectId]); throw error; }
    await pool.query('UPDATE cde_project_mappings SET last_validation_status=$1,last_validated_at=now() WHERE project_id=$2', [status, req.params.projectId]);
    res.json({ valid: true, projectKey: row.project_key, status, checks });
  }));
  app.post('/api/projects/:projectId/cde-branch-selection', asyncRoute(async (req, res) => {
    const row = await mappedAndAccessible(req, req.params.projectId); const type = String(req.body?.repositoryType || ''); const config = REPOSITORY_CONFIG[type];
    if (!config) throw new CdeError('CDE_REPOSITORY_TYPE_INVALID', 'نوع Repository معتبر نیست.', 422);
    const name = String(req.body?.repoName || ''); if (row[config.column] !== name) throw new CdeError('CDE_REPOSITORY_NOT_MAPPED', 'Repository با Mapping پروژه یکسان نیست.', 403);
    const packId = String(req.body?.packId || ''); const loaded = await loadPackage(req, row.project_key, type, packId, row); const selector = req.body?.branch;
    const branch = branchesOf(loaded.item, type).find(candidate => selectorMatches(candidate, selector)); if (!branch) throw new CdeError('CDE_BRANCH_NOT_FOUND', 'شاخه دیگر در دسترس نیست.', 404);
    await pool.query(
      `INSERT INTO cde_branch_selections (user_id,project_id,repository_type,repo_name,pack_id,branch_kind,branch_rand_id,branch_index,last_seen_version_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id,project_id,repository_type,repo_name,pack_id) DO UPDATE SET branch_kind=excluded.branch_kind,branch_rand_id=excluded.branch_rand_id,branch_index=excluded.branch_index,last_seen_version_id=excluded.last_seen_version_id,updated_at=now()`,
      [req.user.id, req.params.projectId, type, name, packId, selector.kind, selector.randId || null, Number.isInteger(selector.index) ? selector.index : null, branch.versionId],
    );
    res.json({ branch: selector, versionId: branch.versionId });
  }));
  app.get('/api/cde/mapped-projects', asyncRoute(async (req, res) => {
    const projects = new Set(await accessible(req)); const params = []; const access = req.user.role === 'ADMIN' ? '' : 'JOIN user_projects up ON up.project_id=p.id AND up.user_id=$1'; if (req.user.role !== 'ADMIN') params.push(req.user.id);
    const rows = await pool.query(`SELECT p.id,p.name,p.code,m.* FROM projects p JOIN cde_project_mappings m ON m.project_id=p.id AND m.enabled=true ${access} WHERE p.is_active=true ORDER BY p.name`, params);
    res.json(rows.rows.filter(row => projects.has(row.project_key)).map(row => ({ id: row.project_id, name: row.name, code: row.code, projectKey: row.project_key, repositories: { webUi: row.web_ui_repo_name, dataService: row.data_service_repo_name, apiModule: row.api_module_repo_name, messageConsumer: row.message_consumer_repo_name, tests: { provider: 'POSTGRESQL', repoName: row.test_repo_name, packId: row.test_pack_id } } })));
  }));
}

module.exports = { CdeError, registerCdeRoutes };

const { SOURCE_APPROACHES, TOOL_KINDS, isApproach } = require('./constants.cjs');
const { getBinding, upsertBinding, serializeBinding } = require('../../../../shared/db/bindings.cjs');
const isService = require('./is/service.cjs');
const localPack = require('./local-pack.cjs');
const gitClient = require('./git/client.cjs');
const zipService = require('./zip/service.cjs');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function serializeConnection(row) {
  if (!row) return { connected: false };
  return {
    connected: true,
    provider: row.provider,
    username: row.username,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

async function loadConnection(pool, userId, provider) {
  const result = await pool.query(
    `SELECT * FROM user_source_connections WHERE user_id=$1 AND provider=$2 AND (expires_at IS NULL OR expires_at > now())`,
    [userId, provider],
  );
  return result.rows[0] || null;
}

async function saveConnection(pool, userId, payload) {
  const result = await pool.query(
    `INSERT INTO user_source_connections (user_id,provider,username,display_name,encrypted_state,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       username=excluded.username, display_name=excluded.display_name, encrypted_state=excluded.encrypted_state,
       expires_at=excluded.expires_at, updated_at=now()
     RETURNING *`,
    [userId, payload.provider, payload.username, payload.displayName, payload.encryptedState, payload.expiresAt],
  );
  return result.rows[0];
}

function registerApproachRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/approaches', asyncRoute(async (_req, res) => {
    res.json({
      approaches: Object.values(SOURCE_APPROACHES),
      tools: Object.values(TOOL_KINDS),
      origins: { github: gitClient.githubOrigin(), gitEdus: gitClient.gitEdusOrigin(), isRoot: isService.isRoot() },
    });
  }));

  app.get('/api/approaches/is/status', asyncRoute(async (_req, res) => {
    res.json(isService.status());
  }));

  app.get('/api/approaches/is/health', asyncRoute(async (_req, res) => {
    res.json(await isService.overallHealth());
  }));

  app.get('/api/approaches/is/packs', asyncRoute(async (_req, res) => {
    res.json(isService.listPacks());
  }));

  app.get('/api/approaches/is/packs/:packId/health', asyncRoute(async (req, res) => {
    res.json(await isService.packHealth(req.params.packId));
  }));

  app.get('/api/approaches/is/packs/:packId', asyncRoute(async (req, res) => {
    const [catalog, health] = await Promise.all([
      Promise.resolve(isService.packCatalog(req.params.packId)),
      isService.packHealth(req.params.packId),
    ]);
    res.json({ ...catalog, health });
  }));

  app.get('/api/approaches/is/packs/:packId/file', asyncRoute(async (req, res) => {
    res.json(isService.readPackFile(req.params.packId, String(req.query.path || '')));
  }));

  app.get('/api/approaches/is/products', asyncRoute(async (_req, res) => {
    res.json(isService.products());
  }));

  app.get('/api/approaches/is/dir', asyncRoute(async (req, res) => {
    res.json(await isService.listDir(String(req.query.path || '')));
  }));

  app.get('/api/approaches/is/test-file', asyncRoute(async (req, res) => {
    res.json(await isService.readTestFile(String(req.query.path || '')));
  }));

  app.put('/api/approaches/is/test-file', asyncRoute(async (req, res) => {
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    const saved = isService.writeTestFile(String(req.body?.path || ''), String(req.body?.sourceCode ?? ''), { create: Boolean(req.body?.create) });
    await audit(pool, req.user.id, saved.created ? 'IS_FILE_CREATED' : 'IS_FILE_UPDATED', 'IS_FILE', saved.path);
    res.json(saved);
  }));

  app.post('/api/approaches/is/dir', asyncRoute(async (req, res) => {
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    const created = await isService.mkdirTestDir(String(req.body?.path || ''));
    await audit(pool, req.user.id, 'IS_DIR_CREATED', 'IS_DIR', created.path);
    res.status(201).json(created);
  }));

  app.delete('/api/approaches/is/entry', asyncRoute(async (req, res) => {
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    const removed = await isService.removeTestPath(String(req.query.path || req.body?.path || ''));
    await audit(pool, req.user.id, 'IS_ENTRY_DELETED', removed.type === 'dir' ? 'IS_DIR' : 'IS_FILE', removed.path);
    res.json(removed);
  }));

  app.get('/api/runtime/packs/:approach/:packKey', asyncRoute(async (req, res) => {
    if (!isApproach(req.params.approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    res.json(localPack.describePack(req.params.approach, req.params.packKey));
  }));

  app.get('/api/runtime/packs/:approach/:packKey/dir', asyncRoute(async (req, res) => {
    if (!isApproach(req.params.approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    res.json(await localPack.listDir(req.params.approach, req.params.packKey, String(req.query.path || ''), String(req.query.recursive || '') === '1'));
  }));

  app.get('/api/runtime/packs/:approach/:packKey/file', asyncRoute(async (req, res) => {
    if (!isApproach(req.params.approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    res.json(await localPack.readFile(req.params.approach, req.params.packKey, String(req.query.path || '')));
  }));

  app.put('/api/runtime/packs/:approach/:packKey/file', asyncRoute(async (req, res) => {
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    if (!isApproach(req.params.approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    const saved = localPack.writeFile(req.params.approach, req.params.packKey, String(req.body?.path || ''), String(req.body?.sourceCode ?? ''), { create: Boolean(req.body?.create) });
    await audit(pool, req.user.id, saved.created ? 'RUNTIME_PACK_FILE_CREATED' : 'RUNTIME_PACK_FILE_UPDATED', 'PACK_FILE', saved.path, { approach: req.params.approach, packKey: req.params.packKey });
    res.json(saved);
  }));

  app.post('/api/runtime/packs/:approach/:packKey/dir', asyncRoute(async (req, res) => {
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    if (!isApproach(req.params.approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    const created = await localPack.mkdirDir(req.params.approach, req.params.packKey, String(req.body?.path || ''));
    await audit(pool, req.user.id, 'RUNTIME_PACK_DIR_CREATED', 'PACK_DIR', created.path, { approach: req.params.approach, packKey: req.params.packKey });
    res.status(201).json(created);
  }));

  app.delete('/api/runtime/packs/:approach/:packKey/entry', asyncRoute(async (req, res) => {
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    if (!isApproach(req.params.approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    const removed = await localPack.removePath(req.params.approach, req.params.packKey, String(req.query.path || req.body?.path || ''));
    await audit(pool, req.user.id, 'RUNTIME_PACK_ENTRY_DELETED', removed.type === 'dir' ? 'PACK_DIR' : 'PACK_FILE', removed.path, { approach: req.params.approach, packKey: req.params.packKey });
    res.json(removed);
  }));

  app.get('/api/workspace/connections', asyncRoute(async (req, res) => {
    const [cde, github, gitEdus, isStatus] = await Promise.all([
      pool.query('SELECT expires_at FROM cde_sessions WHERE session_id=$1 AND expires_at > now()', [req.user.sessionId]),
      loadConnection(pool, req.user.id, 'GITHUB'),
      loadConnection(pool, req.user.id, 'GIT_EDUS'),
      Promise.resolve(isService.status()),
    ]);
    res.json({
      IS: { connected: Boolean(isStatus.connected), ready: Boolean(isStatus.connected), username: null, detail: isStatus.docRoot || isStatus.message },
      CDE: { connected: Boolean(cde.rowCount), ready: Boolean(cde.rowCount), username: null, detail: cde.rowCount ? 'نشست CDE فعال است' : 'وارد CDE شوید تا پروژه‌ها لود شوند' },
      GITHUB: { connected: Boolean(github), ready: Boolean(github), username: github?.username || null, detail: github?.display_name || 'Personal Access Token' },
      GIT_EDUS: { connected: Boolean(gitEdus), ready: Boolean(gitEdus), username: gitEdus?.username || null, detail: gitEdus?.display_name || 'حساب git.edus.ir' },
      ZIP: { connected: true, ready: true, username: null, detail: 'آپلود آرشیو بدون قطع منابع دیگر' },
    });
  }));

  app.post('/api/workspace/runs', asyncRoute(async (req, res) => {
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    const approach = String(req.body?.sourceApproach || 'IS').toUpperCase();
    if (!isApproach(approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    const { ensureWorkspaceProject, createApproachRun } = require('../runs/create-run.cjs');
    const project = await ensureWorkspaceProject(pool, req.user, approach);
    const created = await createApproachRun(pool, req.user, project, req.body);
    await audit(pool, req.user.id, 'WORKSPACE_RUN_QUEUED', 'RUN', created.id, { approach, packId: created.pack_id, toolKind: created.tool_kind });
    res.status(201).json(Object.fromEntries(Object.entries(created).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
      value,
    ])));
  }));

  app.get('/api/workspace/project/:approach', asyncRoute(async (req, res) => {
    const approach = String(req.params.approach || '').toUpperCase();
    if (!isApproach(approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    const { ensureWorkspaceProject } = require('../runs/create-run.cjs');
    res.json(await ensureWorkspaceProject(pool, req.user, approach));
  }));

  app.put('/api/projects/:projectId/source-binding', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const approach = String(req.body?.sourceApproach || '').toUpperCase();
    if (!isApproach(approach)) throw Object.assign(new Error('اپروچ منبع معتبر نیست.'), { status: 422, code: 'INVALID_APPROACH' });
    const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
    if (approach === 'IS') {
      isService.ensureIsLayout();
      const packId = config.packId ? String(config.packId).toUpperCase() : null;
      if (packId) isService.packCatalog(packId);
    }
    const row = await upsertBinding(pool, req.params.projectId, approach, config);
    await audit(pool, req.user.id, 'SOURCE_BINDING_SAVED', 'PROJECT', req.params.projectId, { approach });
    res.json(serializeBinding(row));
  }));

  app.get('/api/projects/:projectId/source-binding', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    const project = await pool.query('SELECT source_approach FROM projects WHERE id=$1', [req.params.projectId]);
    if (!project.rowCount) throw Object.assign(new Error('پروژه پیدا نشد.'), { status: 404, code: 'PROJECT_NOT_FOUND' });
    const binding = serializeBinding(await getBinding(pool, req.params.projectId));
    res.json(binding || { projectId: req.params.projectId, sourceApproach: project.rows[0].source_approach, config: {} });
  }));

  app.get('/api/sources/:provider/session', asyncRoute(async (req, res) => {
    const provider = String(req.params.provider || '').toUpperCase();
    if (!['GITHUB', 'GIT_EDUS'].includes(provider)) throw Object.assign(new Error('ارائه‌دهنده معتبر نیست.'), { status: 422, code: 'INVALID_PROVIDER' });
    res.json(serializeConnection(await loadConnection(pool, req.user.id, provider)));
  }));

  app.post('/api/sources/:provider/session', asyncRoute(async (req, res) => {
    const provider = String(req.params.provider || '').toUpperCase();
    const username = String(req.body?.username || '').trim();
    const secret = String(req.body?.password || req.body?.token || '');
    let payload;
    if (provider === 'GITHUB') payload = await gitClient.loginGithub({ username, token: secret });
    else if (provider === 'GIT_EDUS') payload = await gitClient.loginGitlab({ username, password: secret });
    else throw Object.assign(new Error('ارائه‌دهنده معتبر نیست.'), { status: 422, code: 'INVALID_PROVIDER' });
    const row = await saveConnection(pool, req.user.id, payload);
    await audit(pool, req.user.id, 'SOURCE_CONNECTED', 'SOURCE', provider, { username: payload.username });
    res.json(serializeConnection(row));
  }));

  app.delete('/api/sources/:provider/session', asyncRoute(async (req, res) => {
    const provider = String(req.params.provider || '').toUpperCase();
    await pool.query('DELETE FROM user_source_connections WHERE user_id=$1 AND provider=$2', [req.user.id, provider]);
    await audit(pool, req.user.id, 'SOURCE_DISCONNECTED', 'SOURCE', provider);
    res.status(204).end();
  }));

  app.get('/api/sources/:provider/projects', asyncRoute(async (req, res) => {
    const provider = String(req.params.provider || '').toUpperCase();
    const connection = await loadConnection(pool, req.user.id, provider);
    if (!connection) throw Object.assign(new Error('ابتدا حساب منبع را متصل کنید.'), { status: 401, code: 'SOURCE_NOT_CONNECTED' });
    const projects = provider === 'GITHUB'
      ? await gitClient.listGithubRepos(connection.encrypted_state)
      : await gitClient.listGitlabProjects(connection.encrypted_state);
    res.json({ provider, username: connection.username, projects });
  }));

  app.get('/api/sources/:provider/dir', asyncRoute(async (req, res) => {
    const provider = String(req.params.provider || '').toUpperCase();
    const connection = await loadConnection(pool, req.user.id, provider);
    if (!connection) throw Object.assign(new Error('ابتدا حساب منبع را متصل کنید.'), { status: 401, code: 'SOURCE_NOT_CONNECTED' });
    const filePath = String(req.query.path || '');
    const ref = String(req.query.ref || '');
    const recursive = String(req.query.recursive || '') === '1';
    const entries = provider === 'GITHUB'
      ? await gitClient.listGithubContents(connection.encrypted_state, String(req.query.fullName || ''), filePath, ref, recursive)
      : await gitClient.listGitlabTree(connection.encrypted_state, String(req.query.remoteId || ''), filePath, ref, recursive);
    res.json({ path: filePath, entries });
  }));

  app.get('/api/sources/:provider/file', asyncRoute(async (req, res) => {
    const provider = String(req.params.provider || '').toUpperCase();
    const connection = await loadConnection(pool, req.user.id, provider);
    if (!connection) throw Object.assign(new Error('ابتدا حساب منبع را متصل کنید.'), { status: 401, code: 'SOURCE_NOT_CONNECTED' });
    const filePath = String(req.query.path || '');
    const ref = String(req.query.ref || '');
    const file = provider === 'GITHUB'
      ? await gitClient.readGithubFile(connection.encrypted_state, String(req.query.fullName || ''), filePath, ref)
      : await gitClient.readGitlabFile(connection.encrypted_state, String(req.query.remoteId || ''), filePath, ref);
    res.json(file);
  }));

  app.post('/api/projects/:projectId/source-binding/remote', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const provider = String(req.body?.provider || '').toUpperCase();
    if (!['GITHUB', 'GIT_EDUS'].includes(provider)) throw Object.assign(new Error('ارائه‌دهنده معتبر نیست.'), { status: 422, code: 'INVALID_PROVIDER' });
    const connection = await loadConnection(pool, req.user.id, provider);
    if (!connection) throw Object.assign(new Error('ابتدا حساب منبع را متصل کنید.'), { status: 401, code: 'SOURCE_NOT_CONNECTED' });
    const config = {
      provider,
      remoteId: String(req.body?.remoteId || ''),
      fullName: String(req.body?.fullName || ''),
      defaultBranch: String(req.body?.defaultBranch || 'main'),
      htmlUrl: String(req.body?.htmlUrl || ''),
      cloneUrl: String(req.body?.cloneUrl || ''),
      boundBy: req.user.id,
      boundUsername: connection.username,
    };
    if (!config.remoteId || !config.fullName) throw Object.assign(new Error('پروژه ریموت را انتخاب کنید.'), { status: 422, code: 'REMOTE_REQUIRED' });
    const row = await upsertBinding(pool, req.params.projectId, provider, config);
    await audit(pool, req.user.id, 'SOURCE_REMOTE_BOUND', 'PROJECT', req.params.projectId, { provider, fullName: config.fullName });
    res.json(serializeBinding(row));
  }));

  app.post('/api/projects/:projectId/zip', expressRawZip, asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw Object.assign(new Error('فایل زیپ ارسال نشده است.'), { status: 422, code: 'ZIP_REQUIRED' });
    const originalName = String(req.query.fileName || req.get('x-file-name') || 'source.zip');
    const extracted = await zipService.extractZipBuffer(req.params.projectId, req.body, originalName);
    const row = await upsertBinding(pool, req.params.projectId, 'ZIP', extracted);
    await audit(pool, req.user.id, 'SOURCE_ZIP_UPLOADED', 'PROJECT', req.params.projectId, { fileCount: extracted.fileCount });
    res.json({ binding: serializeBinding(row), extracted });
  }));

  app.get('/api/projects/:projectId/zip/tree', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    res.json(await zipService.listExtractedDir(req.params.projectId, String(req.query.path || '')));
  }));

  app.get('/api/projects/:projectId/zip/file', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    res.json(await zipService.readExtractedFile(req.params.projectId, String(req.query.path || '')));
  }));

  app.put('/api/projects/:projectId/zip/file', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    const saved = await zipService.writeExtractedFile(req.params.projectId, String(req.body?.path || ''), String(req.body?.sourceCode ?? ''), { create: Boolean(req.body?.create) });
    await audit(pool, req.user.id, saved.created ? 'ZIP_FILE_CREATED' : 'ZIP_FILE_UPDATED', 'ZIP_FILE', saved.path, { projectId: req.params.projectId });
    res.json(saved);
  }));

  app.post('/api/projects/:projectId/zip/dir', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    const created = await zipService.mkdirExtracted(req.params.projectId, String(req.body?.path || ''));
    await audit(pool, req.user.id, 'ZIP_DIR_CREATED', 'ZIP_DIR', created.path, { projectId: req.params.projectId });
    res.status(201).json(created);
  }));

  app.delete('/api/projects/:projectId/zip/entry', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    if (req.user.role === 'VIEWER') throw Object.assign(new Error('دسترسی شما فقط خواندنی است.'), { status: 403, code: 'ACCESS_DENIED' });
    const removed = await zipService.removeExtracted(req.params.projectId, String(req.query.path || req.body?.path || ''));
    await audit(pool, req.user.id, 'ZIP_ENTRY_DELETED', removed.type === 'dir' ? 'ZIP_DIR' : 'ZIP_FILE', removed.path, { projectId: req.params.projectId });
    res.json(removed);
  }));
}

function expressRawZip(req, res, next) {
  const express = require('express');
  return express.raw({ type: () => true, limit: process.env.ZIP_MAX_BYTES || '80mb' })(req, res, next);
}

module.exports = { registerApproachRoutes, getBinding, loadConnection, upsertBinding };

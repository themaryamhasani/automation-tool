const { loadCdeProjectContext } = require('../cde/project-context.cjs');
const { ApiError, asyncRoute, camelRow, cleanText, pagination, paged } = require('../http.cjs');
const { audit, ensureProjectAccess } = require('../middleware/auth.cjs');
const { FILE_NAME_PATTERN, FOLDER_PATTERN } = require('../lib/validators.cjs');
const { requireScope } = require('../auth/api-token.cjs');
const { assertSafePlaywrightSource } = require('./source-validation.cjs');
const { registerRecorderFileRoutes } = require('./recorder-routes.cjs');

function bindProjectAccess(pool) {
  return (user, projectId, write = false) => ensureProjectAccess(pool, user, projectId, write);
}

function registerFileRoutes(app, { pool }) {
  const access = bindProjectAccess(pool);
  registerRecorderFileRoutes(app, { pool, audit, ensureProjectAccess: access });

  app.get('/api/files', requireScope('files:read'), asyncRoute(async (req, res) => {
    const projectId = String(req.query.projectId || '');
    await access(req.user, projectId);
    const { page, limit, offset } = pagination(req.query);
    const search = cleanText(req.query.search, 500);
    const where = search ? `AND (f.file_name ILIKE $2 OR f.folder_path ILIKE $2 OR f.description ILIKE $2 OR f.source_code ILIKE $2)` : '';
    const params = search ? [projectId, `%${search}%`] : [projectId];
    const count = await pool.query(`SELECT count(*)::int AS total FROM test_files f WHERE f.project_id=$1 ${where}`, params);
    const result = await pool.query(
      `SELECT f.*, p.name AS project_name, u.full_name AS created_by_name
         FROM test_files f JOIN projects p ON p.id=f.project_id JOIN users u ON u.id=f.created_by
        WHERE f.project_id=$1 ${where} ORDER BY f.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    res.json(paged(result.rows.map(row => ({ ...camelRow(row), fullPath: `${row.folder_path}/${row.file_name}` })), count.rows[0].total, page, limit));
  }));

  app.get('/api/files/folders', requireScope('files:read'), asyncRoute(async (req, res) => {
    const projectId = String(req.query.projectId || '');
    await access(req.user, projectId);
    const result = await pool.query(
      'SELECT folder_path, count(*)::int AS file_count FROM test_files WHERE project_id=$1 GROUP BY folder_path ORDER BY folder_path',
      [projectId],
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/files', requireScope('files:write'), asyncRoute(async (req, res) => {
    const projectId = String(req.body?.projectId || '');
    await access(req.user, projectId, true);
    const project = await pool.query('SELECT source_approach FROM projects WHERE id=$1', [projectId]);
    const cdeContext = project.rows[0]?.source_approach === 'CDE'
      ? await loadCdeProjectContext(pool, req.user, projectId, { requireConnection: false, required: false })
      : { projectKey: null, format: 1 };
    const folderPath = cleanText(req.body?.folderPath, 500).replace(/^\/+|\/+$/g, '') || 'tests';
    const fileName = cleanText(req.body?.fileName, 255).toLowerCase();
    const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : '';
    if (!FOLDER_PATTERN.test(folderPath)) throw new ApiError(422, 'INVALID_FOLDER', 'مسیر پوشه معتبر نیست.');
    if (!FILE_NAME_PATTERN.test(fileName)) throw new ApiError(422, 'INVALID_FILE_NAME', 'نام فایل Playwright معتبر نیست.');
    if (!sourceCode.trim() || Buffer.byteLength(sourceCode) > 2 * 1024 * 1024) throw new ApiError(422, 'INVALID_SOURCE', 'محتوای فایل الزامی و حداکثر دو مگابایت است.');
    assertSafePlaywrightSource(sourceCode);
    const result = await pool.query(
      `INSERT INTO test_files (project_id,folder_path,file_name,description,source_code,created_by,cde_project_key,cde_binding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
      [projectId, folderPath, fileName, cleanText(req.body?.description, 700) || null, sourceCode, req.user.id, cdeContext.projectKey, JSON.stringify(cdeContext)],
    );
    await audit(pool, req.user.id, 'TEST_FILE_CREATED', 'TEST_FILE', result.rows[0].id, { projectId, path: `${folderPath}/${fileName}`, origin: cleanText(req.body?.origin, 40) || 'web' });
    res.status(201).json({ ...camelRow(result.rows[0]), fullPath: `${folderPath}/${fileName}` });
  }));

  app.get('/api/files/:id', requireScope('files:read'), asyncRoute(async (req, res) => {
    const current = await pool.query(
      `SELECT f.*, p.name AS project_name FROM test_files f JOIN projects p ON p.id=f.project_id WHERE f.id=$1`,
      [req.params.id],
    );
    if (!current.rowCount) throw new ApiError(404, 'FILE_NOT_FOUND', 'فایل پیدا نشد.');
    await access(req.user, current.rows[0].project_id);
    const row = current.rows[0];
    res.json({
      ...camelRow(row),
      fullPath: `${row.folder_path}/${row.file_name}`,
      path: `${row.folder_path}/${row.file_name}`,
      name: row.file_name,
      code: row.source_code,
    });
  }));

  app.put('/api/files/:id', requireScope('files:write'), asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT * FROM test_files WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw new ApiError(404, 'FILE_NOT_FOUND', 'فایل پیدا نشد.');
    await access(req.user, current.rows[0].project_id, true);
    const project = await pool.query('SELECT source_approach FROM projects WHERE id=$1', [current.rows[0].project_id]);
    const cdeContext = project.rows[0]?.source_approach === 'CDE'
      ? await loadCdeProjectContext(pool, req.user, current.rows[0].project_id, { requireConnection: false, required: false })
      : { projectKey: null, format: 1 };
    const folderPath = cleanText(req.body?.folderPath, 500).replace(/^\/+|\/+$/g, '');
    const fileName = cleanText(req.body?.fileName, 255).toLowerCase();
    const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : '';
    const expectedRevision = Number(req.body?.revision);
    if (!FOLDER_PATTERN.test(folderPath) || !FILE_NAME_PATTERN.test(fileName) || !sourceCode.trim()) {
      throw new ApiError(422, 'INVALID_FILE', 'اطلاعات فایل معتبر نیست.');
    }
    assertSafePlaywrightSource(sourceCode);
    const result = await pool.query(
      `UPDATE test_files SET folder_path=$1,file_name=$2,description=$3,source_code=$4,revision=revision+1,updated_by=$5,
                             cde_project_key=$6,cde_binding=$7::jsonb,updated_at=now()
        WHERE id=$8 AND revision=$9 RETURNING *`,
      [folderPath, fileName, cleanText(req.body?.description, 700) || null, sourceCode, req.user.id, cdeContext.projectKey, JSON.stringify(cdeContext), req.params.id, expectedRevision],
    );
    if (!result.rowCount) throw new ApiError(409, 'REVISION_CONFLICT', 'فایل توسط کاربر دیگری تغییر کرده است؛ دوباره بارگذاری کنید.');
    await audit(pool, req.user.id, 'TEST_FILE_UPDATED', 'TEST_FILE', req.params.id, { revision: result.rows[0].revision, origin: cleanText(req.body?.origin, 40) || 'web' });
    res.json({ ...camelRow(result.rows[0]), fullPath: `${folderPath}/${fileName}` });
  }));

  app.delete('/api/files/:id', requireScope('files:write'), asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT project_id FROM test_files WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw new ApiError(404, 'FILE_NOT_FOUND', 'فایل پیدا نشد.');
    await access(req.user, current.rows[0].project_id, true);
    await pool.query('DELETE FROM test_files WHERE id=$1', [req.params.id]);
    await audit(pool, req.user.id, 'TEST_FILE_DELETED', 'TEST_FILE', req.params.id);
    res.status(204).end();
  }));
}

module.exports = { registerFileRoutes };

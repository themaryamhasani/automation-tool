const { loadCdeProjectContext } = require('../cde/project-context.cjs');
const { ApiError, asyncRoute, camelRow, cleanText } = require('../http.cjs');
const { requireScope } = require('../auth/api-token.cjs');
const { FILE_NAME_PATTERN, FOLDER_PATTERN } = require('../lib/validators.cjs');
const { sourceValidation, assertSafePlaywrightSource } = require('./source-validation.cjs');

function registerRecorderFileRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.post('/api/files/validate', requireScope('files:write'), asyncRoute(async (req, res) => {
    const projectId = String(req.body?.projectId || '');
    await ensureProjectAccess(req.user, projectId, true);
    const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : '';
    res.json(sourceValidation(sourceCode));
  }));

  app.put('/api/files/upsert', requireScope('files:write'), asyncRoute(async (req, res) => {
    const projectId = String(req.body?.projectId || '');
    await ensureProjectAccess(req.user, projectId, true);
    const folderPath = cleanText(req.body?.folderPath, 500).replace(/^\/+|\/+$/g, '') || 'recorded';
    const fileName = cleanText(req.body?.fileName, 255).toLowerCase();
    const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : '';
    const expectedRevision = req.body?.revision == null ? null : Number(req.body.revision);
    if (!FOLDER_PATTERN.test(folderPath)) throw new ApiError(422, 'INVALID_FOLDER', 'The destination folder is invalid.');
    if (!FILE_NAME_PATTERN.test(fileName)) throw new ApiError(422, 'INVALID_FILE_NAME', 'The destination file name is invalid.');
    if (!sourceCode.trim() || Buffer.byteLength(sourceCode) > 2 * 1024 * 1024) {
      throw new ApiError(422, 'INVALID_SOURCE', 'Test source is required and must be no larger than 2 MB.');
    }
    if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
      throw new ApiError(422, 'REVISION_INVALID', 'The expected revision is invalid.');
    }
    assertSafePlaywrightSource(sourceCode);
    const project = await pool.query('SELECT source_approach FROM projects WHERE id=$1', [projectId]);
    const cdeContext = project.rows[0]?.source_approach === 'CDE'
      ? await loadCdeProjectContext(pool, req.user, projectId, { requireConnection: false, required: false })
      : null;
    const result = await pool.query(
      `INSERT INTO test_files (project_id,folder_path,file_name,description,source_code,created_by,updated_by,cde_project_key,cde_binding)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8::jsonb)
       ON CONFLICT (project_id,folder_path,file_name) DO UPDATE
         SET description=EXCLUDED.description,source_code=EXCLUDED.source_code,
             revision=test_files.revision+1,updated_by=EXCLUDED.updated_by,
             cde_project_key=EXCLUDED.cde_project_key,cde_binding=EXCLUDED.cde_binding,updated_at=now()
       WHERE $9::integer IS NULL OR test_files.revision=$9
       RETURNING *, (xmax=0) AS was_created`,
      [projectId, folderPath, fileName, cleanText(req.body?.description, 700) || null, sourceCode, req.user.id, cdeContext?.projectKey || null, cdeContext ? JSON.stringify(cdeContext) : null, expectedRevision],
    );
    if (!result.rowCount) throw new ApiError(409, 'REVISION_CONFLICT', 'The saved test changed. Reload it before overwriting the newer revision.');
    const row = result.rows[0];
    await audit(pool, req.user.id, 'TEST_FILE_UPSERTED', 'TEST_FILE', row.id, {
      projectId,
      path: `${folderPath}/${fileName}`,
      revision: row.revision,
      operation: row.was_created ? 'created' : 'updated',
      origin: cleanText(req.body?.origin, 40) || 'chrome-extension',
    });
    const payload = { ...camelRow(row), fullPath: `${folderPath}/${fileName}` };
    delete payload.wasCreated;
    res.status(row.was_created ? 201 : 200).json(payload);
  }));
}

module.exports = { registerRecorderFileRoutes };

const { isApproach } = require('../approaches/constants.cjs');
const { ApiError, asyncRoute, camelRow, cleanText } = require('../http.cjs');
const { audit, requireRole, ensureProjectAccess } = require('../middleware/auth.cjs');
const {
  validHttpUrl, environmentAvailability, environmentSecretReferences,
} = require('../lib/validators.cjs');

function bindProjectAccess(pool) {
  return (user, projectId, write = false) => ensureProjectAccess(pool, user, projectId, write);
}

function registerProjectRoutes(app, { pool }) {
  const access = bindProjectAccess(pool);

  app.get('/api/projects', asyncRoute(async (req, res) => {
    const params = [];
    const join = req.user.role === 'ADMIN' ? '' : 'JOIN user_projects up ON up.project_id = p.id AND up.user_id = $1';
    if (req.user.role !== 'ADMIN') params.push(req.user.id);
    const includeWorkspace = String(req.query?.includeWorkspace || '') === '1';
    const kindFilter = includeWorkspace ? '' : " AND p.kind = 'NAMED'";
    const result = await pool.query(
      `SELECT p.*, count(DISTINCT e.id)::int AS environment_count, count(DISTINCT f.id)::int AS file_count
         FROM projects p ${join}
         LEFT JOIN environments e ON e.project_id = p.id
         LEFT JOIN test_files f ON f.project_id = p.id
        WHERE true${kindFilter}
        GROUP BY p.id ORDER BY p.is_active DESC, p.name`,
      params,
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/projects', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const name = cleanText(req.body?.name, 255);
    const code = cleanText(req.body?.code, 80).toLowerCase();
    const sourceApproach = isApproach(String(req.body?.sourceApproach || 'CDE').toUpperCase())
      ? String(req.body?.sourceApproach || 'CDE').toUpperCase() : 'CDE';
    if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(code)) throw new ApiError(422, 'INVALID_PROJECT', 'نام و کد انگلیسی معتبر وارد کنید.');
    if (/^ws-/.test(code)) throw new ApiError(422, 'WORKSPACE_CODE_RESERVED', 'کدهای ws-* برای فضای کار سیستمی رزرو شده‌اند.');
    const result = await pool.query(
      `INSERT INTO projects (name, code, description, source_approach, kind) VALUES ($1, $2, $3, $4, 'NAMED') RETURNING *`,
      [name, code, cleanText(req.body?.description, 5000) || null, sourceApproach],
    );
    await audit(pool, req.user.id, 'PROJECT_CREATED', 'PROJECT', result.rows[0].id);
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/projects/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const name = cleanText(req.body?.name, 255);
    const code = cleanText(req.body?.code, 80).toLowerCase();
    const sourceApproach = isApproach(String(req.body?.sourceApproach || 'CDE').toUpperCase())
      ? String(req.body?.sourceApproach || 'CDE').toUpperCase() : 'CDE';
    if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(code)) throw new ApiError(422, 'INVALID_PROJECT', 'نام و کد انگلیسی معتبر وارد کنید.');
    const existing = await pool.query('SELECT id, kind FROM projects WHERE id=$1', [req.params.id]);
    if (!existing.rowCount) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'پروژه پیدا نشد.');
    if (existing.rows[0].kind === 'WORKSPACE') {
      throw new ApiError(409, 'WORKSPACE_PROJECT_READONLY', 'پروژه‌های فضای کار سیستمی از این مسیر ویرایش نمی‌شوند.');
    }
    if (/^ws-/.test(code)) throw new ApiError(422, 'WORKSPACE_CODE_RESERVED', 'کدهای ws-* برای فضای کار سیستمی رزرو شده‌اند.');
    const result = await pool.query(
      `UPDATE projects SET name=$1, code=$2, description=$3, is_active=$4, source_approach=$5, kind='NAMED', updated_at=now()
        WHERE id=$6 AND kind='NAMED' RETURNING *`,
      [name, code, cleanText(req.body?.description, 5000) || null, req.body?.isActive !== false, sourceApproach, req.params.id],
    );
    if (!result.rowCount) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'پروژه پیدا نشد.');
    await audit(pool, req.user.id, 'PROJECT_UPDATED', 'PROJECT', req.params.id);
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/projects/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const existing = await pool.query('SELECT id, name, is_active, kind FROM projects WHERE id=$1', [req.params.id]);
    if (!existing.rowCount) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'پروژه پیدا نشد.');
    if (existing.rows[0].kind === 'WORKSPACE') {
      throw new ApiError(409, 'WORKSPACE_PROJECT_READONLY', 'پروژه‌های فضای کار سیستمی حذف نمی‌شوند.');
    }
    const runCount = await pool.query('SELECT count(*)::int AS total FROM runs WHERE project_id=$1', [req.params.id]);
    if (runCount.rows[0].total > 0) {
      const archived = await pool.query(
        `UPDATE projects SET is_active=false, updated_at=now() WHERE id=$1 RETURNING *`,
        [req.params.id],
      );
      await audit(pool, req.user.id, 'PROJECT_ARCHIVED', 'PROJECT', req.params.id, { reason: 'HAS_RUNS', runCount: runCount.rows[0].total });
      res.json({ ...camelRow(archived.rows[0]), archived: true, deleted: false, runCount: runCount.rows[0].total });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
      await audit(client, req.user.id, 'PROJECT_DELETED', 'PROJECT', req.params.id, { name: existing.rows[0].name });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.json({ id: req.params.id, deleted: true, archived: false });
  }));

  app.get('/api/projects/:projectId/environments', asyncRoute(async (req, res) => {
    await access(req.user, req.params.projectId);
    const result = await pool.query(
      `SELECT *, (enabled AND (available_from IS NULL OR available_from<=now()) AND (available_until IS NULL OR available_until>now())) AS available_now
         FROM environments WHERE project_id=$1 ORDER BY enabled DESC, name`,
      [req.params.projectId],
    );
    res.json(result.rows.map(row => {
      const serialized = camelRow(row);
      if (req.user.role !== 'ADMIN') delete serialized.secretReferences;
      return serialized;
    }));
  }));

  app.post('/api/projects/:projectId/environments', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    await access(req.user, req.params.projectId, true);
    const name = cleanText(req.body?.name, 120);
    const baseUrl = validHttpUrl(req.body?.baseUrl, true);
    const availability = environmentAvailability(req.body);
    if (!name) throw new ApiError(422, 'ENVIRONMENT_NAME_REQUIRED', 'نام محیط الزامی است.');
    const result = await pool.query(
      `INSERT INTO environments (project_id,name,base_url,api_base_url,gateway_base_url,secret_references,enabled,available_from,available_until)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING *`,
      [req.params.projectId, name, baseUrl, validHttpUrl(req.body?.apiBaseUrl), validHttpUrl(req.body?.gatewayBaseUrl),
        JSON.stringify(environmentSecretReferences(req.body?.secretReferences)), req.body?.enabled !== false,
        availability.availableFrom, availability.availableUntil],
    );
    await audit(pool, req.user.id, 'ENVIRONMENT_CREATED', 'ENVIRONMENT', result.rows[0].id, { projectId: req.params.projectId });
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/environments/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const name = cleanText(req.body?.name, 120);
    const baseUrl = validHttpUrl(req.body?.baseUrl, true);
    const availability = environmentAvailability(req.body);
    const result = await pool.query(
      `UPDATE environments SET name=$1,base_url=$2,api_base_url=$3,gateway_base_url=$4,secret_references=$5::jsonb,enabled=$6,available_from=$7,available_until=$8,updated_at=now()
        WHERE id=$9 RETURNING *`,
      [name, baseUrl, validHttpUrl(req.body?.apiBaseUrl), validHttpUrl(req.body?.gatewayBaseUrl),
        JSON.stringify(environmentSecretReferences(req.body?.secretReferences)), req.body?.enabled !== false,
        availability.availableFrom, availability.availableUntil, req.params.id],
    );
    if (!result.rowCount) throw new ApiError(404, 'ENVIRONMENT_NOT_FOUND', 'محیط پیدا نشد.');
    await audit(pool, req.user.id, 'ENVIRONMENT_UPDATED', 'ENVIRONMENT', req.params.id);
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/environments/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const result = await pool.query('DELETE FROM environments WHERE id=$1 RETURNING project_id', [req.params.id]);
    if (!result.rowCount) throw new ApiError(404, 'ENVIRONMENT_NOT_FOUND', 'محیط پیدا نشد.');
    await audit(pool, req.user.id, 'ENVIRONMENT_DELETED', 'ENVIRONMENT', req.params.id);
    res.status(204).end();
  }));
}

module.exports = { registerProjectRoutes };

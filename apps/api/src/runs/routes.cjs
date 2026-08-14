const fs = require('node:fs');
const path = require('node:path');
const { ApiError, asyncRoute, camelRow, cleanText, pagination, paged } = require('../http.cjs');
const { createApproachRun } = require('./create-run.cjs');
const { notifyRun } = require('../../../../shared/log-excerpt.cjs');
const {
  RUN_EVENT_COLUMNS, RUN_SNAPSHOT_JSON, RUN_SNAPSHOT_LIST_JSON, RUN_ARTIFACTS_JSON, attachRunSse,
} = require('./events.cjs');

function artifactRoot() {
  return path.resolve(process.env.ARTIFACT_ROOT || path.resolve(process.cwd(), 'artifacts', 'playwright'));
}

function safeArtifactPath(relativePath) {
  const root = artifactRoot();
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new ApiError(400, 'INVALID_ARTIFACT_PATH', 'مسیر فایل خروجی معتبر نیست.');
  }
  return { root, target };
}

function registerRunRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/runs', asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const projectId = cleanText(req.query.projectId, 100);
    if (projectId) await ensureProjectAccess(req.user, projectId);
    const values = [];
    const clauses = [];
    if (req.user.role !== 'ADMIN') {
      values.push(req.user.id);
      clauses.push(`EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id=r.project_id AND up.user_id=$${values.length})`);
    }
    if (projectId) { values.push(projectId); clauses.push(`r.project_id=$${values.length}`); }
    const status = cleanText(req.query.status, 30);
    if (status) { values.push(status); clauses.push(`r.status=$${values.length}`); }
    const sourceApproach = cleanText(req.query.sourceApproach, 30);
    if (sourceApproach) { values.push(sourceApproach); clauses.push(`r.source_approach=$${values.length}`); }
    const packId = cleanText(req.query.packId, 255);
    if (packId) { values.push(packId); clauses.push(`r.pack_id=$${values.length}`); }
    const search = cleanText(req.query.search, 500);
    if (search) { values.push(`%${search}%`); clauses.push(`(r.test_file_path ILIKE $${values.length} OR p.name ILIKE $${values.length})`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = await pool.query(`SELECT count(*)::int AS total FROM runs r JOIN projects p ON p.id=r.project_id ${where}`, values);
    const result = await pool.query(
      `SELECT ${RUN_EVENT_COLUMNS}, p.name AS project_name, e.name AS environment_name, e.base_url,
              u.full_name AS requested_by_name, ${RUN_SNAPSHOT_LIST_JSON}, ${RUN_ARTIFACTS_JSON}
         FROM runs r JOIN projects p ON p.id=r.project_id JOIN environments e ON e.id=r.environment_id JOIN users u ON u.id=r.requested_by
         ${where} ORDER BY r.requested_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    res.json(paged(result.rows.map(camelRow), count.rows[0].total, page, limit));
  }));

  app.get('/api/runs/:id', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT ${RUN_EVENT_COLUMNS}, p.name AS project_name, e.name AS environment_name, e.base_url, u.full_name AS requested_by_name,
              ${RUN_SNAPSHOT_JSON}, ${RUN_ARTIFACTS_JSON}
         FROM runs r JOIN projects p ON p.id=r.project_id JOIN environments e ON e.id=r.environment_id JOIN users u ON u.id=r.requested_by WHERE r.id=$1`,
      [req.params.id],
    );
    if (!result.rowCount) throw new ApiError(404, 'RUN_NOT_FOUND', 'اجرا پیدا نشد.');
    await ensureProjectAccess(req.user, result.rows[0].project_id);
    res.json(camelRow(result.rows[0]));
  }));

  app.get('/api/runs/:id/events', asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT project_id FROM runs WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw new ApiError(404, 'RUN_NOT_FOUND', 'اجرا پیدا نشد.');
    await ensureProjectAccess(req.user, current.rows[0].project_id);
    attachRunSse(req, res, {
      runId: req.params.id,
      loadRun: async () => {
        const result = await pool.query(
          `SELECT ${RUN_EVENT_COLUMNS}, p.name AS project_name, e.name AS environment_name, e.base_url, u.full_name AS requested_by_name,
                  ${RUN_SNAPSHOT_JSON}, ${RUN_ARTIFACTS_JSON}
             FROM runs r JOIN projects p ON p.id=r.project_id JOIN environments e ON e.id=r.environment_id JOIN users u ON u.id=r.requested_by WHERE r.id=$1`,
          [req.params.id],
        );
        return camelRow(result.rows[0]);
      },
    });
    await new Promise(resolve => req.on('close', resolve));
  }));

  app.get('/api/runs/:id/logs', asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT project_id, logs FROM runs WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw new ApiError(404, 'RUN_NOT_FOUND', 'اجرا پیدا نشد.');
    await ensureProjectAccess(req.user, current.rows[0].project_id);
    const artifact = await pool.query(
      `SELECT relative_path FROM artifacts WHERE run_id=$1 AND kind='LOG' ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
    );
    if (artifact.rowCount) {
      const { target } = safeArtifactPath(artifact.rows[0].relative_path);
      try {
        await fs.promises.access(target);
        res.type('text/plain; charset=utf-8');
        fs.createReadStream(target, { encoding: 'utf8' }).pipe(res);
        return;
      } catch {
        /* fall through to DB excerpt */
      }
    }
    res.type('text/plain; charset=utf-8').send(current.rows[0].logs || '');
  }));

  app.post('/api/runs', asyncRoute(async (req, res) => {
    const projectId = String(req.body?.projectId || '');
    await ensureProjectAccess(req.user, projectId, true);
    const projectRow = await pool.query('SELECT id, name, code, source_approach FROM projects WHERE id=$1', [projectId]);
    if (!projectRow.rowCount) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'پروژه پیدا نشد.');
    const created = await createApproachRun(pool, req.user, camelRow(projectRow.rows[0]), req.body);
    await audit(pool, req.user.id, created.status === 'PREPARING' ? 'RUN_PREPARING_CDE_SNAPSHOT' : 'RUN_QUEUED', 'RUN', created.id, {
      projectId, approach: created.source_approach, toolKind: created.tool_kind, packId: created.pack_id, flowId: created.flow_id,
    });
    res.status(201).json(camelRow(created));
  }));

  app.post('/api/runs/:id/cancel', asyncRoute(async (req, res) => {
    const current = await pool.query('SELECT id, project_id, status, cde_snapshot_id FROM runs WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw new ApiError(404, 'RUN_NOT_FOUND', 'اجرا پیدا نشد.');
    await ensureProjectAccess(req.user, current.rows[0].project_id, true);
    const targetStatus = ['PREPARING', 'QUEUED'].includes(current.rows[0].status) ? 'CANCELLED' : 'CANCEL_REQUESTED';
    const updated = await pool.query(
      `UPDATE runs SET status=$1, completed_at=CASE WHEN $1='CANCELLED' THEN now() ELSE completed_at END, updated_at=now()
        WHERE id=$2 AND status IN ('PREPARING','QUEUED','RUNNING') RETURNING id`,
      [targetStatus, req.params.id],
    );
    if (!updated.rowCount) throw new ApiError(409, 'RUN_NOT_CANCELLABLE', 'این اجرا قابل لغو نیست.');
    if (targetStatus === 'CANCELLED' && current.rows[0].cde_snapshot_id) {
      await pool.query("UPDATE cde_source_snapshots SET status='PURGED',purged_at=now(),initiating_session_id=NULL,updated_at=now() WHERE id=$1 AND status IN ('PENDING','MATERIALIZING')", [current.rows[0].cde_snapshot_id]);
      await pool.query('DELETE FROM cde_snapshot_files WHERE snapshot_id=$1', [current.rows[0].cde_snapshot_id]);
    }
    await audit(pool, req.user.id, 'RUN_CANCEL_REQUESTED', 'RUN', req.params.id);
    await notifyRun(pool, req.params.id);
    const result = await pool.query(
      `SELECT ${RUN_EVENT_COLUMNS} FROM runs r WHERE r.id=$1`,
      [req.params.id],
    );
    res.json(camelRow(result.rows[0]));
  }));

  app.get('/api/artifacts/:id/download', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT a.id, a.relative_path, a.file_name, r.project_id FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE a.id=$1`,
      [req.params.id],
    );
    if (!result.rowCount) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'فایل خروجی پیدا نشد.');
    await ensureProjectAccess(req.user, result.rows[0].project_id);
    const { target } = safeArtifactPath(result.rows[0].relative_path);
    try { await fs.promises.access(target); } catch { throw new ApiError(410, 'ARTIFACT_GONE', 'فایل خروجی دیگر روی دیسک موجود نیست.'); }
    res.download(target, result.rows[0].file_name);
  }));
}

module.exports = { registerRunRoutes };

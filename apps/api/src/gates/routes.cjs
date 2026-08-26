const { ApiError, asyncRoute, camelRow, cleanText } = require('../http.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { evaluateQualityGate } = require('../../../../shared/quality-gate.cjs');

function registerGateRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/projects/:projectId/gates', asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId);
    const result = await pool.query(
      `SELECT id, project_id, name, enabled, max_failed_tests, max_fail_rate, require_status,
              block_on_flaky, max_flaky_fail_rate, post_scm_status, created_at, updated_at
         FROM quality_gates WHERE project_id = $1 ORDER BY name`,
      [req.params.projectId],
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/projects/:projectId/gates', requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const name = cleanText(req.body?.name, 120) || 'default';
    const result = await pool.query(
      `INSERT INTO quality_gates (
          project_id, name, enabled, max_failed_tests, max_fail_rate, require_status,
          block_on_flaky, max_flaky_fail_rate, post_scm_status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.params.projectId,
        name,
        req.body?.enabled !== false,
        req.body?.maxFailedTests == null ? null : Number(req.body.maxFailedTests),
        req.body?.maxFailRate == null ? null : Number(req.body.maxFailRate),
        cleanText(req.body?.requireStatus, 24) || 'PASSED',
        Boolean(req.body?.blockOnFlaky),
        req.body?.maxFlakyFailRate == null ? 0.5 : Number(req.body.maxFlakyFailRate),
        req.body?.postScmStatus !== false,
        req.user.id,
      ],
    );
    await audit(pool, req.user.id, 'QUALITY_GATE_CREATED', 'QUALITY_GATE', result.rows[0].id, { projectId: req.params.projectId });
    res.status(201).json(camelRow(result.rows[0]));
  }));

  app.put('/api/projects/:projectId/gates/:gateId', requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const result = await pool.query(
      `UPDATE quality_gates SET
          name = COALESCE($3, name),
          enabled = COALESCE($4, enabled),
          max_failed_tests = COALESCE($5, max_failed_tests),
          max_fail_rate = COALESCE($6, max_fail_rate),
          require_status = COALESCE($7, require_status),
          block_on_flaky = COALESCE($8, block_on_flaky),
          max_flaky_fail_rate = COALESCE($9, max_flaky_fail_rate),
          post_scm_status = COALESCE($10, post_scm_status),
          updated_at = now()
        WHERE id = $1 AND project_id = $2
        RETURNING *`,
      [
        req.params.gateId,
        req.params.projectId,
        cleanText(req.body?.name, 120) || null,
        req.body?.enabled == null ? null : Boolean(req.body.enabled),
        req.body?.maxFailedTests == null ? null : Number(req.body.maxFailedTests),
        req.body?.maxFailRate == null ? null : Number(req.body.maxFailRate),
        cleanText(req.body?.requireStatus, 24) || null,
        req.body?.blockOnFlaky == null ? null : Boolean(req.body.blockOnFlaky),
        req.body?.maxFlakyFailRate == null ? null : Number(req.body.maxFlakyFailRate),
        req.body?.postScmStatus == null ? null : Boolean(req.body.postScmStatus),
      ],
    );
    if (!result.rowCount) throw new ApiError(404, 'GATE_NOT_FOUND', 'Quality gate پیدا نشد.');
    await audit(pool, req.user.id, 'QUALITY_GATE_UPDATED', 'QUALITY_GATE', req.params.gateId);
    res.json(camelRow(result.rows[0]));
  }));

  app.delete('/api/projects/:projectId/gates/:gateId', requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    await ensureProjectAccess(req.user, req.params.projectId, true);
    const deleted = await pool.query(
      'DELETE FROM quality_gates WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.gateId, req.params.projectId],
    );
    if (!deleted.rowCount) throw new ApiError(404, 'GATE_NOT_FOUND', 'Quality gate پیدا نشد.');
    await audit(pool, req.user.id, 'QUALITY_GATE_DELETED', 'QUALITY_GATE', req.params.gateId);
    res.json({ ok: true });
  }));

  app.post('/api/runs/:id/gate/evaluate', requireRole('ADMIN', 'OPERATOR'), asyncRoute(async (req, res) => {
    const run = await pool.query(
      `SELECT id, project_id, status, failed_tests, total_tests, test_file_path, tool_kind, pack_id, flow_id
         FROM runs WHERE id = $1`,
      [req.params.id],
    );
    if (!run.rowCount) throw new ApiError(404, 'RUN_NOT_FOUND', 'اجرا پیدا نشد.');
    await ensureProjectAccess(req.user, run.rows[0].project_id, true);
    const evaluation = await evaluateQualityGate(pool, run.rows[0]);
    res.json(evaluation);
  }));

  app.get('/api/pipeline/gate', asyncRoute(async (req, res) => {
    const projectId = cleanText(req.query.projectId, 100);
    const commitSha = cleanText(req.query.commitSha, 64);
    if (!projectId || !commitSha) throw new ApiError(422, 'GATE_QUERY_REQUIRED', 'projectId و commitSha الزامی است.');
    await ensureProjectAccess(req.user, projectId);
    const run = await pool.query(
      `SELECT r.id, r.project_id, r.status, r.gate_status, res.gate_summary, r.failed_tests, r.total_tests,
              scm.commit_sha, r.completed_at
         FROM runs r
         LEFT JOIN run_results res ON res.run_id = r.id
         LEFT JOIN run_scm scm ON scm.run_id = r.id
        WHERE r.project_id = $1 AND scm.commit_sha = $2 AND r.status IN ('PASSED','FAILED','ERROR','CANCELLED')
        ORDER BY r.completed_at DESC NULLS LAST, r.requested_at DESC
        LIMIT 1`,
      [projectId, commitSha],
    );
    if (!run.rowCount) {
      res.status(404).json({ passed: false, code: 'RUN_NOT_FOUND', message: 'اجرایی برای این commit پیدا نشد.' });
      return;
    }
    const row = run.rows[0];
    const passed = row.gate_status
      ? row.gate_status === 'PASSED'
      : row.status === 'PASSED';
    res.status(passed ? 200 : 409).json({
      passed,
      runId: row.id,
      status: row.status,
      gateStatus: row.gate_status,
      gateSummary: row.gate_summary,
      commitSha: row.commit_sha,
    });
  }));
}

module.exports = { registerGateRoutes };

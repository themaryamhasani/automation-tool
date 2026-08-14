const { ApiError } = require('../http.cjs');

async function loadCdeProjectContext(pool, user, projectId, { requireConnection = true, required = false } = {}) {
  const mapping = await pool.query(
    `SELECT m.*,
            EXISTS (
              SELECT 1 FROM cde_sessions cs
               WHERE cs.session_id=$2 AND cs.expires_at > now()
            ) AS cde_connected
       FROM cde_project_mappings m
      WHERE m.project_id=$1`,
    [projectId, user.sessionId],
  );
  if (!mapping.rowCount) {
    if (required) throw new ApiError(409, 'CDE_MAPPING_REQUIRED', 'برای این پروژه Mapping CDE ثبت نشده است.');
    return { format: 1, projectKey: null, connected: false };
  }
  const row = mapping.rows[0];
  if (!row.enabled) {
    if (required) throw new ApiError(409, 'CDE_MAPPING_DISABLED', 'Mapping CDE این پروژه غیرفعال است.');
    return { format: 1, projectKey: null, connected: false };
  }
  if (requireConnection && !row.cde_connected) throw new ApiError(401, 'CDE_CONNECTION_REQUIRED', 'ابتدا حساب CDE را متصل کنید.');
  const selections = await pool.query(
    `SELECT repository_type,repo_name,pack_id,branch_kind,branch_rand_id,branch_index,last_seen_version_id,updated_at
       FROM cde_branch_selections WHERE user_id=$1 AND project_id=$2
      ORDER BY repository_type,repo_name,pack_id`,
    [user.id, projectId],
  );
  return {
    format: 1,
    serviceId: row.service_id,
    projectKey: row.project_key,
    repositories: {
      webUi: row.web_ui_repo_name,
      dataService: row.data_service_repo_name,
      apiModule: row.api_module_repo_name,
      messageConsumer: row.message_consumer_repo_name,
      tests: { provider: 'POSTGRESQL', repoName: row.test_repo_name, packId: row.test_pack_id || `playwright/${row.project_key}` },
    },
    branchSelections: selections.rows.map(selection => ({
      repositoryType: selection.repository_type,
      repoName: selection.repo_name,
      packId: selection.pack_id,
      branch: selection.branch_kind === 'PUBLIC'
        ? { kind: 'PUBLIC' }
        : { kind: 'PERSONAL', ...(selection.branch_rand_id ? { randId: selection.branch_rand_id } : {}), ...(Number.isInteger(selection.branch_index) ? { index: selection.branch_index } : {}) },
      versionId: selection.last_seen_version_id,
      selectedAt: selection.updated_at,
    })),
    capturedAt: new Date().toISOString(),
    connected: Boolean(row.cde_connected),
  };
}

module.exports = { loadCdeProjectContext };

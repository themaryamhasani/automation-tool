const { decryptText } = require('./snapshot-crypto.cjs');
const {
  statusStateFromRun, postGithubCommitStatus, postGitlabCommitStatus, splitFullName, gitEdusOrigin,
} = require('./git/status-checks.cjs');

function publicRunUrl(runId) {
  const base = String(process.env.PUBLIC_WEB_BASE_URL || process.env.API_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/runs?runId=${runId}` : null;
}

async function loadConnectionToken(pool, userId, provider) {
  const result = await pool.query(
    `SELECT encrypted_state FROM user_source_connections
      WHERE user_id = $1 AND provider = $2 AND expires_at > now()
      ORDER BY updated_at DESC LIMIT 1`,
    [userId, provider],
  );
  if (!result.rowCount) return null;
  try {
    const state = JSON.parse(decryptText(result.rows[0].encrypted_state));
    return state.accessToken || state.token || null;
  } catch {
    return null;
  }
}

async function postScmStatusForRun(pool, run, { gatePassed } = {}) {
  const sha = run.commit_sha;
  if (!sha) return null;
  const provider = String(run.source_approach || '').toUpperCase();
  if (provider !== 'GITHUB' && provider !== 'GIT_EDUS') return null;

  let remote = {};
  try { remote = JSON.parse(run.source_snapshot || '{}').remote || {}; } catch { /* ignore */ }
  const state = statusStateFromRun(run.status, gatePassed);
  const description = gatePassed === false
    ? 'Quality gate failed'
    : `${run.status} · ${run.passed_tests || 0} passed / ${run.failed_tests || 0} failed`;
  const targetUrl = publicRunUrl(run.id);
  const context = process.env.SCM_STATUS_CONTEXT || 'automation-tool/quality';
  const token = await loadConnectionToken(pool, run.requested_by, provider);
  if (!token) {
    await pool.query(
      `INSERT INTO scm_status_posts (run_id, provider, commit_sha, state, target_url, context_name, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [run.id, provider, sha, state, targetUrl, context, 'No source connection token for requester'],
    );
    return null;
  }

  try {
    let responseStatus = 0;
    if (provider === 'GITHUB') {
      const parts = splitFullName(remote.fullName);
      if (!parts) throw new Error('Remote fullName is required for GitHub status.');
      const posted = await postGithubCommitStatus({
        token,
        owner: parts.owner,
        repo: parts.repo,
        sha,
        state,
        description,
        targetUrl,
        context,
      });
      responseStatus = posted.status;
    } else {
      const posted = await postGitlabCommitStatus({
        origin: gitEdusOrigin(),
        token,
        projectId: remote.remoteId,
        sha,
        state,
        description,
        targetUrl,
        name: context,
      });
      responseStatus = posted.status;
    }
    await pool.query(
      `INSERT INTO scm_status_posts (run_id, provider, commit_sha, state, target_url, context_name, response_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [run.id, provider, sha, state, targetUrl, context, responseStatus],
    );
    return { state, responseStatus };
  } catch (error) {
    await pool.query(
      `INSERT INTO scm_status_posts (run_id, provider, commit_sha, state, target_url, context_name, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [run.id, provider, sha, state, targetUrl, context, error instanceof Error ? error.message : String(error)],
    );
    return null;
  }
}

module.exports = { postScmStatusForRun, publicRunUrl };

const { githubOrigin, gitEdusOrigin, GitError } = require('./client.cjs');

function statusStateFromRun(status, gatePassed) {
  const normalized = String(status || '').toUpperCase();
  if (gatePassed === false) return 'failure';
  if (normalized === 'PASSED') return 'success';
  if (normalized === 'CANCELLED') return 'error';
  if (normalized === 'FAILED' || normalized === 'ERROR') return 'failure';
  return 'pending';
}

async function postGithubCommitStatus({ token, owner, repo, sha, state, description, targetUrl, context }) {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/statuses/${encodeURIComponent(sha)}`;
  const response = await fetch(`${githubOrigin()}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'automation-tool',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      state,
      description: String(description || '').slice(0, 140),
      target_url: targetUrl || undefined,
      context: context || 'automation-tool/quality',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new GitError('GITHUB_STATUS_FAILED', text.slice(0, 200) || `GitHub status HTTP ${response.status}`, response.status);
  }
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function postGitlabCommitStatus({ origin, token, projectId, sha, state, description, targetUrl, name }) {
  const mapped = state === 'success' ? 'success'
    : state === 'pending' ? 'pending'
      : state === 'error' ? 'failed'
        : 'failed';
  const params = new URLSearchParams({
    state: mapped,
    name: name || 'automation-tool/quality',
    description: String(description || '').slice(0, 255),
  });
  if (targetUrl) params.set('target_url', targetUrl);
  const response = await fetch(
    `${origin}/api/v4/projects/${encodeURIComponent(projectId)}/statuses/${encodeURIComponent(sha)}?${params}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'PRIVATE-TOKEN': token,
        'User-Agent': 'automation-tool',
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new GitError('GITLAB_STATUS_FAILED', text.slice(0, 200) || `GitLab status HTTP ${response.status}`, response.status);
  }
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function splitFullName(fullName) {
  const parts = String(fullName || '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts.slice(1).join('/') };
}

module.exports = {
  statusStateFromRun,
  postGithubCommitStatus,
  postGitlabCommitStatus,
  splitFullName,
  gitEdusOrigin,
};

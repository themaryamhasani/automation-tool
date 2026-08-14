const { encryptText, decryptText } = require('../../../../../shared/snapshot-crypto.cjs');

class GitError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function githubOrigin() {
  return String(process.env.GITHUB_API_ORIGIN || 'https://api.github.com').replace(/\/$/, '');
}

function gitEdusOrigin() {
  return String(process.env.GIT_EDUS_ORIGIN || 'https://git.edus.ir').replace(/\/$/, '');
}

function parseState(encrypted) {
  try { return JSON.parse(decryptText(encrypted)); }
  catch { throw new GitError('SOURCE_SESSION_INVALID', 'نشست منبع منقضی یا نامعتبر است؛ دوباره وارد شوید.', 401); }
}

function nextFromLink(header) {
  const parts = String(header || '').split(',');
  for (const part of parts) {
    const url = part.match(/<([^>]+)>/);
    const rel = part.match(/rel="?([^"]+)"?/);
    if (url && rel && rel[1].trim() === 'next') return url[1];
  }
  return '';
}

async function githubRequest(token, urlOrPath, extra = {}) {
  const { withResponse, headers, ...rest } = extra;
  const url = String(urlOrPath).startsWith('http') ? urlOrPath : `${githubOrigin()}${urlOrPath}`;
  const response = await fetch(url, {
    ...rest,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'automation-tool',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = body?.message || `GitHub HTTP ${response.status}`;
    throw new GitError('GITHUB_HTTP_ERROR', message, response.status === 401 ? 401 : 502, { status: response.status });
  }
  if (withResponse) return { body, headers: response.headers };
  return body;
}

async function gitlabRequest(origin, auth, pathname, extra = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': 'automation-tool', ...(extra.headers || {}) };
  if (auth.type === 'oauth') headers.Authorization = `Bearer ${auth.accessToken}`;
  else if (auth.type === 'pat') headers['PRIVATE-TOKEN'] = auth.accessToken;
  else if (auth.cookie) headers.Cookie = auth.cookie;
  const response = await fetch(`${origin}${pathname}`, { ...extra, headers });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = body?.message || body?.error || `GitLab HTTP ${response.status}`;
    throw new GitError('GITLAB_HTTP_ERROR', String(message), response.status === 401 ? 401 : 502, { status: response.status });
  }
  return body;
}

async function loginGithub({ username, token }) {
  const accessToken = String(token || '').trim();
  if (!accessToken) throw new GitError('GITHUB_TOKEN_REQUIRED', 'Personal Access Token گیت‌هاب الزامی است.', 422);
  const user = await githubRequest(accessToken, '/user');
  if (username && user.login && username.toLowerCase() !== String(user.login).toLowerCase()) {
    throw new GitError('GITHUB_USER_MISMATCH', 'نام کاربری با توکن گیت‌هاب مطابقت ندارد.', 422);
  }
  return {
    provider: 'GITHUB',
    username: user.login,
    displayName: user.name || user.login,
    encryptedState: encryptText(JSON.stringify({ type: 'pat', accessToken, username: user.login })),
    expiresAt: null,
  };
}

async function loginGitlab({ username, password }) {
  const origin = gitEdusOrigin();
  const userName = String(username || '').trim();
  const secret = String(password || '');
  if (!userName || !secret) throw new GitError('GITLAB_CREDENTIALS_REQUIRED', 'نام کاربری و رمز git.edus.ir الزامی است.', 422);

  const oauth = await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'password', username: userName, password: secret, scope: 'api read_repository' }),
  }).catch(() => null);
  if (oauth?.ok) {
    const json = await oauth.json();
    const me = await gitlabRequest(origin, { type: 'oauth', accessToken: json.access_token }, '/api/v4/user');
    return {
      provider: 'GIT_EDUS',
      username: me.username,
      displayName: me.name || me.username,
      encryptedState: encryptText(JSON.stringify({
        type: 'oauth',
        accessToken: json.access_token,
        refreshToken: json.refresh_token || null,
        username: me.username,
      })),
      expiresAt: json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000) : null,
    };
  }

  try {
    const me = await gitlabRequest(origin, { type: 'pat', accessToken: secret }, '/api/v4/user');
    return {
      provider: 'GIT_EDUS',
      username: me.username,
      displayName: me.name || me.username,
      encryptedState: encryptText(JSON.stringify({ type: 'pat', accessToken: secret, username: me.username })),
      expiresAt: null,
    };
  } catch {
    // continue to session login
  }

  const signIn = await fetch(`${origin}/users/sign_in`, { redirect: 'manual' });
  const html = await signIn.text();
  const authenticity = html.match(/name="authenticity_token"[^>]*value="([^"]+)"/)?.[1]
    || html.match(/value="([^"]+)"[^>]*name="authenticity_token"/)?.[1];
  if (!authenticity) throw new GitError('GITLAB_LOGIN_UNSUPPORTED', 'ورود تعاملی GitLab در دسترس نیست. یک Personal Access Token با دسترسی api بسازید و به‌جای رمز وارد کنید.', 422);
  const cookieHeader = (typeof signIn.headers.getSetCookie === 'function' ? signIn.headers.getSetCookie() : [])
    .map(item => item.split(';')[0]).join('; ');
  const body = new URLSearchParams({
    utf8: '✓',
    authenticity_token: authenticity,
    'user[login]': userName,
    'user[password]': secret,
    'user[remember_me]': '0',
  });
  const posted = await fetch(`${origin}/users/sign_in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader,
      Origin: origin,
      Referer: `${origin}/users/sign_in`,
    },
    body,
    redirect: 'manual',
  });
  const sessionCookies = (typeof posted.headers.getSetCookie === 'function' ? posted.headers.getSetCookie() : [])
    .map(item => item.split(';')[0]).filter(Boolean);
  if (posted.status >= 400 || !sessionCookies.length) {
    throw new GitError('GITLAB_LOGIN_FAILED', 'ورود به git.edus.ir ناموفق بود. نام کاربری/رمز را بررسی کنید یا از Personal Access Token استفاده کنید.', 401);
  }
  const cookie = sessionCookies.join('; ');
  const me = await gitlabRequest(origin, { type: 'session', cookie }, '/api/v4/user');
  return {
    provider: 'GIT_EDUS',
    username: me.username,
    displayName: me.name || me.username,
    encryptedState: encryptText(JSON.stringify({ type: 'session', cookie, username: me.username })),
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
  };
}

async function listGithubRepos(encryptedState) {
  const auth = parseState(encryptedState);
  const rows = await githubRequest(auth.accessToken, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return (Array.isArray(rows) ? rows : []).map(repo => ({
    id: String(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch || 'main',
    htmlUrl: repo.html_url,
    cloneUrl: repo.clone_url,
    description: repo.description || '',
    updatedAt: repo.updated_at,
  }));
}

async function listGitlabProjects(encryptedState) {
  const origin = gitEdusOrigin();
  const auth = parseState(encryptedState);
  const rows = await gitlabRequest(origin, auth, '/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at&sort=desc');
  return (Array.isArray(rows) ? rows : []).map(project => ({
    id: String(project.id),
    name: project.name,
    fullName: project.path_with_namespace,
    private: project.visibility !== 'public',
    defaultBranch: project.default_branch || 'main',
    htmlUrl: project.web_url,
    cloneUrl: project.http_url_to_repo,
    description: project.description || '',
    updatedAt: project.last_activity_at,
  }));
}

async function downloadGithubArchive(encryptedState, owner, repo, ref) {
  const auth = parseState(encryptedState);
  const response = await fetch(`${githubOrigin()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref || '')}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'automation-tool' },
  });
  if (!response.ok) throw new GitError('GITHUB_ARCHIVE_FAILED', 'دانلود آرشیو GitHub ناموفق بود.', 502);
  return Buffer.from(await response.arrayBuffer());
}

async function downloadGitlabArchive(encryptedState, projectId, ref) {
  const origin = gitEdusOrigin();
  const auth = parseState(encryptedState);
  const query = ref ? `?sha=${encodeURIComponent(ref)}` : '';
  const headers = { 'User-Agent': 'automation-tool' };
  if (auth.type === 'oauth') headers.Authorization = `Bearer ${auth.accessToken}`;
  else if (auth.type === 'pat') headers['PRIVATE-TOKEN'] = auth.accessToken;
  else if (auth.cookie) headers.Cookie = auth.cookie;
  const response = await fetch(`${origin}/api/v4/projects/${encodeURIComponent(projectId)}/repository/archive.zip${query}`, { headers });
  if (!response.ok) throw new GitError('GITLAB_ARCHIVE_FAILED', 'دانلود آرشیو git.edus.ir ناموفق بود.', 502);
  return Buffer.from(await response.arrayBuffer());
}

function decodeBase64(content) {
  return Buffer.from(String(content || '').replace(/\n/g, ''), 'base64').toString('utf8');
}

function nestFromFlat(items, rootPath = '') {
  const prefix = rootPath ? `${String(rootPath).replace(/\/$/, '')}/` : '';
  const dirNames = new Set();
  const files = [];
  for (const item of items) {
    const itemPath = String(item.path || '');
    if (rootPath && itemPath !== rootPath && !itemPath.startsWith(prefix)) continue;
    const rel = rootPath ? (itemPath === rootPath ? '' : itemPath.slice(prefix.length)) : itemPath;
    if (!rel) continue;
    const parts = rel.split('/').filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1) {
      const isDir = item.type === 'tree' || item.type === 'dir';
      if (isDir) dirNames.add(parts[0]);
      else files.push({ name: parts[0], path: itemPath, type: 'file', size: Number(item.size || 0) });
    } else {
      dirNames.add(parts[0]);
    }
  }
  const dirs = [...dirNames].map(name => {
    const dirPath = rootPath ? `${rootPath}/${name}` : name;
    return { name, path: dirPath, type: 'dir', children: nestFromFlat(items, dirPath) };
  });
  return [...dirs, ...files].sort((left, right) => Number(right.type === 'dir') - Number(left.type === 'dir') || left.name.localeCompare(right.name));
}

async function listGithubContents(encryptedState, fullName, filePath = '', ref, recursive = false) {
  const auth = parseState(encryptedState);
  const [owner, repo] = String(fullName || '').split('/');
  if (!owner || !repo) throw new GitError('REMOTE_REQUIRED', 'نام ریپو معتبر نیست.', 422);
  if (recursive) {
    try {
      const treeRef = ref || 'HEAD';
      const body = await githubRequest(auth.accessToken, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`);
      const raw = Array.isArray(body?.tree) ? body.tree : [];
      const items = raw.slice(0, 1500).map(item => ({
        path: item.path,
        type: item.type === 'tree' ? 'tree' : 'blob',
        size: item.size || 0,
      }));
      return nestFromFlat(items, filePath);
    } catch {
      /* fall through to one-level listing */
    }
  }
  const suffix = filePath ? `/${String(filePath).split('/').map(encodeURIComponent).join('/')}` : '';
  const params = new URLSearchParams({ per_page: '100' });
  if (ref) params.set('ref', ref);
  let next = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${suffix}?${params}`;
  const rows = [];
  while (next) {
    const { body, headers } = await githubRequest(auth.accessToken, next, { withResponse: true });
    const chunk = Array.isArray(body) ? body : (body && (body.type === 'file' || body.type === 'dir') ? [body] : []);
    rows.push(...chunk);
    next = nextFromLink(headers.get('link'));
    if (rows.length > 8000) break;
  }
  return rows
    .filter(item => item.type === 'file' || item.type === 'dir')
    .map(item => ({
      name: item.name,
      path: item.path,
      type: item.type === 'dir' ? 'dir' : 'file',
      size: Number(item.size || 0),
    }))
    .sort((left, right) => Number(right.type === 'dir') - Number(left.type === 'dir') || left.name.localeCompare(right.name));
}

async function readGithubFile(encryptedState, fullName, filePath, ref) {
  const auth = parseState(encryptedState);
  const [owner, repo] = String(fullName || '').split('/');
  if (!owner || !repo || !filePath) throw new GitError('REMOTE_REQUIRED', 'مسیر فایل معتبر نیست.', 422);
  const suffix = String(filePath).split('/').map(encodeURIComponent).join('/');
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const body = await githubRequest(auth.accessToken, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${suffix}${query}`);
  if (body?.type !== 'file') throw new GitError('GITHUB_NOT_A_FILE', 'این مسیر یک فایل متنی نیست.', 422);
  if (Number(body.size || 0) > 1_500_000) throw new GitError('GITHUB_FILE_TOO_LARGE', 'فایل برای نمایش خیلی بزرگ است.', 422);
  if (!body.content && body.encoding !== 'base64') throw new GitError('GITHUB_FILE_BINARY', 'فقط فایل‌های متنی قابل مشاهده‌اند.', 422);
  return { path: body.path || filePath, name: body.name || filePath.split('/').pop(), code: decodeBase64(body.content), size: Number(body.size || 0) };
}

async function listGitlabTree(encryptedState, projectId, filePath = '', ref, recursive = false) {
  const origin = gitEdusOrigin();
  const auth = parseState(encryptedState);
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const params = new URLSearchParams({ per_page: '100', page: String(page) });
    if (filePath) params.set('path', filePath);
    if (ref) params.set('ref', ref);
    if (recursive) params.set('recursive', 'true');
    const chunk = await gitlabRequest(origin, auth, `/api/v4/projects/${encodeURIComponent(projectId)}/repository/tree?${params}`);
    const list = Array.isArray(chunk) ? chunk : [];
    rows.push(...list);
    if (list.length < 100) break;
  }
  const mapped = rows
    .filter(item => item.type === 'tree' || item.type === 'blob')
    .map(item => ({
      name: item.name,
      path: item.path,
      type: item.type === 'tree' ? 'dir' : 'file',
      size: 0,
    }));
  if (recursive) {
    return nestFromFlat(mapped.map(item => ({ path: item.path, type: item.type === 'dir' ? 'tree' : 'blob', size: 0 })), filePath);
  }
  return mapped.sort((left, right) => Number(right.type === 'dir') - Number(left.type === 'dir') || left.name.localeCompare(right.name));
}

async function readGitlabFile(encryptedState, projectId, filePath, ref) {
  const origin = gitEdusOrigin();
  const auth = parseState(encryptedState);
  if (!projectId || !filePath) throw new GitError('REMOTE_REQUIRED', 'مسیر فایل معتبر نیست.', 422);
  const query = `?ref=${encodeURIComponent(ref || 'HEAD')}`;
  const encoded = encodeURIComponent(filePath);
  const body = await gitlabRequest(origin, auth, `/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encoded}${query}`);
  if (Number(body.size || 0) > 1_500_000) throw new GitError('GITLAB_FILE_TOO_LARGE', 'فایل برای نمایش خیلی بزرگ است.', 422);
  return { path: body.file_path || filePath, name: body.file_name || filePath.split('/').pop(), code: decodeBase64(body.content), size: Number(body.size || 0) };
}

module.exports = {
  GitError,
  githubOrigin,
  gitEdusOrigin,
  loginGithub,
  loginGitlab,
  listGithubRepos,
  listGitlabProjects,
  listGithubContents,
  readGithubFile,
  listGitlabTree,
  readGitlabFile,
  downloadGithubArchive,
  downloadGitlabArchive,
  parseState,
};

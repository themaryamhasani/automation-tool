const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { decryptText } = require('../../../shared/snapshot-crypto.cjs');
const { buildExpressPackage } = require('../../api/src/cde/express-pack.cjs');

function sha256(crypto, value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function loadSnapshotFiles(pool, snapshotId) {
  if (!snapshotId) return { files: [], manifest: null };
  const snapshot = await pool.query('SELECT status,manifest,file_count,content_hash FROM cde_source_snapshots WHERE id=$1', [snapshotId]);
  if (!snapshot.rowCount || snapshot.rows[0].status !== 'READY') throw new Error('Snapshot سورس CDE آماده نیست.');
  const rows = await pool.query('SELECT path,encrypted_source,source_hash,repository_type,repo_name,pack_id,version_id FROM cde_snapshot_files WHERE snapshot_id=$1 ORDER BY path', [snapshotId]);
  const crypto = require('node:crypto');
  const files = rows.rows.map(file => {
    const code = decryptText(file.encrypted_source);
    if (sha256(crypto, code) !== file.source_hash) throw new Error(`یکپارچگی Snapshot برای ${file.path} رد شد.`);
    return {
      path: file.path,
      code,
      repositoryType: file.repository_type,
      repoName: file.repo_name,
      packId: file.pack_id,
      versionId: file.version_id,
    };
  });
  return { files, manifest: snapshot.rows[0].manifest };
}

function waitForHealth(baseUrl, timeoutMs = 20_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          if (body.ok) return resolve(body);
        }
      } catch { /* retry */ }
      if (Date.now() - started > timeoutMs) return reject(new Error(`رانتایم Express روی ${baseUrl} بالا نیامد.`));
      setTimeout(tick, 400);
    };
    void tick();
  });
}

function startRuntime(appRoot, port) {
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: appRoot,
    windowsHide: true,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const append = chunk => { logs += chunk.toString('utf8'); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  return {
    child,
    logs: () => logs,
    async stop() {
      if (!child.killed) {
        child.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!child.killed) child.kill('SIGKILL');
      }
    },
  };
}

async function writeSnapshotTree(pool, snapshotId, dest) {
  const { files } = await loadSnapshotFiles(pool, snapshotId);
  fs.mkdirSync(dest, { recursive: true });
  const root = path.resolve(dest);
  for (const file of files) {
    const relative = String(file.path || '').replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) continue;
    const target = path.resolve(root, ...relative.split('/'));
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.code || '', 'utf8');
  }
  return { dest: root, fileCount: files.length };
}

async function materializeExpressRuntime(pool, run) {
  const projectKey = run.pack_id || run.cde_project_key;
  if (!projectKey) throw new Error('کلید پروژه CDE برای رانتایم مشخص نیست.');
  const { files, manifest } = await loadSnapshotFiles(pool, run.cde_snapshot_id);
  if (!files.length) throw new Error('سورس CDE برای ساخت پکیج Express خالی است.');
  const built = buildExpressPackage({
    projectKey,
    files,
    packages: manifest?.packages || [],
  });
  const runtime = startRuntime(built.appRoot, built.port);
  try {
    await waitForHealth(built.baseUrl);
  } catch (error) {
    const output = runtime.logs();
    await runtime.stop();
    throw new Error(`${error.message}\n${output.slice(-2000)}`);
  }
  return { ...built, runtime, snapshotManifest: manifest };
}

module.exports = { materializeExpressRuntime, loadSnapshotFiles, writeSnapshotTree };

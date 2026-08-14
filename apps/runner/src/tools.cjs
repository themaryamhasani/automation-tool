const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { packPaths } = require('../../api/src/approaches/is/service.cjs');
const { getPack } = require('../../api/src/approaches/is/packs.cjs');
const { persistIsReports, parseSummary, parsePlaywrightJson } = require('./is-reports.cjs');
const { runProcess, playwrightJob, playwrightRepoJob, findRepoPlaywrightConfig, unitJob, resolveBin, ensureNpmInstall } = require('./process.cjs');
const { writeLocalTaxonomy } = require('./local-reports.cjs');
const gitClient = require('../../api/src/approaches/git/client.cjs');
const { projectZipRoot } = require('../../api/src/approaches/zip/service.cjs');
const localPack = require('../../api/src/approaches/local-pack.cjs');
const { materializeExpressRuntime, loadSnapshotFiles } = require('./cde-runtime.cjs');

function snapshotOf(run) {
  try { return JSON.parse(run.source_snapshot || '{}'); }
  catch { return {}; }
}

function mergeDotEnv(env, cwd) {
  if (!cwd) return env;
  const file = path.join(cwd, '.env');
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) continue;
    const key = text.slice(0, index).trim().replace(/^\uFEFF/, '');
    let value = text.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}

function envWithDotEnv(cwd, extra = {}) {
  return mergeDotEnv({ ...process.env, ...extra, FORCE_COLOR: '0', CI: '1' }, cwd);
}

function playwrightCwd(specPath, e2eCwd) {
  let dir = path.dirname(path.resolve(specPath));
  for (let i = 0; i < 8; i += 1) {
    if (['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some(name => fs.existsSync(path.join(dir, name)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fs.existsSync(e2eCwd) ? e2eCwd : path.dirname(specPath);
}

async function executeIsRun(run, { shouldCancel, workspace, onLog }) {
  const pack = getPack(run.pack_id);
  if (!pack) throw new Error('بسته IS برای این اجرا پیدا نشد.');
  const paths = packPaths(pack.id);
  const timeout = Number(run.timeout_seconds || 900);
  let command;
  let args;
  let cwd;
  let env = envWithDotEnv(paths.dangerCwd);
  let jsonFile = null;

  if (run.tool_kind === 'DANGER') {
    const flow = String(run.flow_id || run.tool_target || 'ALL').toUpperCase();
    if (flow === 'ALL') {
      cwd = path.join(paths.productRoot, 'scripts');
      const script = path.join(cwd, 'run-by-flow.mjs');
      if (!fs.existsSync(script)) throw new Error(`اسکریپت danger پیدا نشد: ${script}`);
      command = process.execPath;
      args = [script];
      env = envWithDotEnv(paths.dangerCwd);
    } else {
      cwd = paths.dangerCwd;
      const entry = path.join(cwd, pack.danger.entry);
      if (!fs.existsSync(entry)) throw new Error(`اسکریپت danger پیدا نشد: ${entry}`);
      command = process.execPath;
      args = fs.existsSync(path.join(cwd, '.env'))
        ? ['--env-file=.env', pack.danger.entry, `--flow=${flow}`]
        : [pack.danger.entry, `--flow=${flow}`];
      env = envWithDotEnv(cwd);
    }
  } else if (run.tool_kind === 'K6') {
    cwd = paths.k6Cwd;
    const script = path.join(cwd, pack.k6.script);
    if (!fs.existsSync(script)) throw new Error(`اسکریپت k6 پیدا نشد: ${script}`);
    const k6 = resolveBin('k6');
    command = k6.command;
    args = ['run', pack.k6.script];
    env = envWithDotEnv(cwd);
  } else if (run.tool_kind === 'PLAYWRIGHT') {
    const selected = String(run.tool_target || run.test_file_path || '').replace(/\\/g, '/').replace(/^doc\//, '');
    const isSpec = /\.(spec|test)\.(ts|js|mjs)$/i.test(selected);
    let specPath = null;
    if (isSpec) {
      specPath = path.resolve(paths.docRoot, ...selected.split('/'));
      if (!fs.existsSync(specPath)) throw new Error(`فایل Playwright پیدا نشد: ${selected}`);
    }
    cwd = specPath ? playwrightCwd(specPath, paths.e2eCwd) : paths.e2eCwd;
    const job = playwrightJob({
      cwd,
      specPath,
      workspace,
      baseURL: pack.e2eBaseUrl,
      headed: Boolean(run.headed),
    });
    command = job.command;
    args = job.args;
    cwd = job.cwd;
    jsonFile = job.jsonFile;
    env = mergeDotEnv(mergeDotEnv(envWithDotEnv(cwd), paths.e2eCwd), paths.dangerCwd);
    env = {
      ...env,
      ...job.envExtra,
      PW_CHANNEL: pack.e2e.channel || job.envExtra.PW_CHANNEL || 'chrome',
      E2E_BASE_URL: pack.e2eBaseUrl || env.E2E_BASE_URL,
    };
  } else if (run.tool_kind === 'VITEST') {
    cwd = paths.unitCwd;
    if (!fs.existsSync(cwd)) throw new Error(`پوشه unit سرویس پیدا نشد: ${cwd}`);
    const job = unitJob(pack.unit.command, cwd);
    command = job.command;
    args = job.args;
    env = envWithDotEnv(cwd);
  } else {
    throw new Error(`Unsupported IS tool: ${run.tool_kind}`);
  }

  let result;
  try {
    result = await runProcess(command, args, cwd, env, timeout, shouldCancel, onLog);
  } catch (error) {
    if (run.tool_kind === 'K6' && process.platform === 'win32') {
      result = await runProcess('k6', args, cwd, env, timeout, shouldCancel, onLog);
    } else {
      throw error;
    }
  }
  const reports = await persistIsReports({
    packId: pack.id,
    toolKind: run.tool_kind,
    flowId: run.flow_id,
    code: result.code,
    out: result.out,
    jsonFile,
  });
  return {
    exitCode: result.code,
    logs: `${result.out}\n\n--- command ---\n${command} ${args.join(' ')}\n\n--- build-report-boards ---\n${reports.boardOut || ''}`.trim(),
    summary: {
      total: reports.stats.total,
      passed: reports.stats.pass,
      failed: reports.stats.fail,
      skipped: reports.stats.skip,
      details: reports.stats.details || [],
    },
    reportFiles: [reports.raw?.target].filter(Boolean),
    reportPaths: { product: `test/doc/${pack.docPath}/reports` },
    command: [command, ...args],
  };
}

async function unzipTo(buffer, workspace) {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    const relative = String(name).replace(/\\/g, '/');
    if (!relative || relative.split('/').some(part => part === '..')) continue;
    const dest = path.resolve(workspace, ...relative.split('/'));
    if (!dest.startsWith(`${workspace}${path.sep}`) && dest !== workspace) continue;
    if (entry.dir) {
      fs.mkdirSync(dest, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await entry.async('nodebuffer'));
  }
}

function flattenArchiveRoot(workspace) {
  const entries = fs.readdirSync(workspace, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(workspace, entries[0].name);
  }
  return workspace;
}

async function materializeRemote(run, workspace, pool) {
  const snap = snapshotOf(run);
  if (run.source_approach === 'ZIP') {
    const root = projectZipRoot(run.project_id);
    if (!fs.existsSync(root)) throw new Error('محتوای زیپ استخراج‌شده پیدا نشد.');
    return root;
  }
  const provider = run.source_approach;
  const connection = await pool.query(
    `SELECT encrypted_state FROM user_source_connections WHERE user_id=$1 AND provider=$2 AND (expires_at IS NULL OR expires_at > now())`,
    [run.requested_by, provider],
  );
  if (!connection.rowCount) throw new Error('نشست منبع برای دانلود سورس منقضی شده است.');
  const remote = snap.remote || {};
  let buffer;
  if (provider === 'GITHUB') {
    const [owner, repo] = String(remote.fullName || '').split('/');
    buffer = await gitClient.downloadGithubArchive(connection.rows[0].encrypted_state, owner, repo, remote.defaultBranch);
  } else {
    buffer = await gitClient.downloadGitlabArchive(connection.rows[0].encrypted_state, remote.remoteId, remote.defaultBranch);
  }
  await unzipTo(buffer, workspace);
  return flattenArchiveRoot(workspace);
}

function overlayLocalPack(snap, sourceRoot) {
  const packRoot = snap.packRoot;
  if (!packRoot || !fs.existsSync(packRoot)) return;
  for (const folder of ['scripts', 'flows', 'cases']) {
    const from = path.join(packRoot, folder);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(sourceRoot, folder), { recursive: true });
  }
}

function allAppRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

function siblingCheckout(run) {
  const fullName = String(snapshotOf(run).remote?.fullName || '');
  const repo = fullName.split('/')[1] || '';
  if (!repo) return null;
  const candidate = path.join(allAppRoot(), repo);
  if (fs.existsSync(path.join(candidate, 'playwright.config.ts')) || fs.existsSync(path.join(candidate, 'playwright.config.js'))) {
    return candidate;
  }
  return null;
}

async function pingOk(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

const SKIP_CHECKOUT = new Set(['node_modules', 'dist', 'build', '.git', 'test-results', 'playwright-report', 'coverage', 'artifacts', '.next']);

function isolateSiblingCheckout(run, workspace) {
  const sibling = siblingCheckout(run);
  if (!sibling) return null;
  const dest = path.join(workspace, 'checkout');
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(sibling, dest, {
    recursive: true,
    dereference: true,
    filter(src) {
      const rel = path.relative(sibling, src);
      if (!rel || rel === '.') return true;
      return !rel.split(path.sep).some(part => SKIP_CHECKOUT.has(part));
    },
  });
  return dest;
}

async function executeSourceToolRun(run, { shouldCancel, pool, workspace, onLog }) {
  const isolated = isolateSiblingCheckout(run, workspace);
  let sourceRoot = isolated || await materializeRemote(run, workspace, pool);
  overlayLocalPack(snapshotOf(run), sourceRoot);
  const timeout = Math.max(Number(run.timeout_seconds || 900), 1800);
  const target = [run.test_file_path, run.tool_target]
    .map(value => String(value || '').replace(/\\/g, '/'))
    .find(value => value && value !== '.' && value !== 'ALL') || '.';
  const workCwd = target === '.' ? sourceRoot : path.resolve(sourceRoot, ...target.split('/').slice(0, -1));
  const cwd = fs.existsSync(workCwd) ? workCwd : sourceRoot;
  let command;
  let args;
  const env = mergeDotEnv({ ...process.env, FORCE_COLOR: '0' }, sourceRoot);
  if (run.tool_kind === 'K6') {
    const k6 = resolveBin('k6');
    command = k6.command;
    args = ['run', path.basename(target) === '.' ? 'k6.js' : path.basename(target)];
  } else if (run.tool_kind === 'VITEST') {
    await ensureNpmInstall(sourceRoot, shouldCancel);
    const job = unitJob(['npx', 'vitest', 'run'], cwd);
    command = job.command;
    args = job.args;
  } else if (run.tool_kind === 'DANGER') {
    command = process.execPath;
    args = [path.basename(target) || 'run.mjs'];
  } else {
    await ensureNpmInstall(sourceRoot, shouldCancel);
    const specPath = target !== '.' && /\.(spec|test)\.(ts|js|mjs)$/i.test(target)
      ? path.resolve(sourceRoot, ...target.split('/'))
      : null;
    if (specPath && !fs.existsSync(specPath)) throw new Error(`فایل Playwright در ریپو پیدا نشد: ${target}`);
    const repoConfig = findRepoPlaywrightConfig(sourceRoot);
    if (repoConfig) {
      const apiBase = process.env.UTMS_API_BASE_URL || 'http://127.0.0.1:4174';
      const webBase = process.env.UTMS_WEB_BASE_URL || 'http://127.0.0.1:5173';
      env.UTMS_API_BASE_URL = apiBase;
      env.UTMS_WEB_BASE_URL = webBase;
      env.BASE_URL = webBase;
      env.E2E_BASE_URL = webBase;
      env.VITE_DEV_API_PROXY_TARGET = apiBase;
      env.API_CONSOLE_PORT = String(new URL(apiBase).port || '4174');
      env.API_CONSOLE_CORS_ORIGIN = webBase;
      if (await pingOk(`${apiBase.replace(/\/$/, '')}/api/health`) && await pingOk(webBase)) {
        env.PLAYWRIGHT_SKIP_WEBSERVER = '1';
      } else {
        env.AUTOMATION_UNSET_CI = '1';
        env.CI = '';
        delete env.PLAYWRIGHT_SKIP_WEBSERVER;
      }
      const job = playwrightRepoJob({ sourceRoot, specPath, workspace });
      Object.assign(env, job.envExtra);
      const result = await runProcess(job.command, job.args, job.cwd, env, timeout, shouldCancel, onLog);
      const jsonFile = [
        job.jsonFile,
        path.join(sourceRoot, 'artifacts', 'tests', 'json', 'results.json'),
      ].find(file => file && fs.existsSync(file));
      return finishSource(run, result, [job.command, ...job.args], jsonFile);
    }
    const e2eCwd = specPath ? playwrightCwd(specPath, path.join(sourceRoot, 'scripts', 'e2e')) : (fs.existsSync(path.join(sourceRoot, 'scripts', 'e2e')) ? path.join(sourceRoot, 'scripts', 'e2e') : cwd);
    const job = playwrightJob({
      cwd: e2eCwd,
      specPath,
      workspace,
      headed: Boolean(run.headed),
      baseURL: process.env.UTMS_WEB_BASE_URL || process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    });
    Object.assign(env, job.envExtra);
    return finishSource(run, await runProcess(job.command, job.args, job.cwd, env, timeout, shouldCancel, onLog), [job.command, ...job.args], job.jsonFile);
  }
  const result = await runProcess(command, args, cwd, env, timeout, shouldCancel, onLog);
  return finishSource(run, result, [command, ...args]);
}

function finishSource(run, result, command, jsonFile) {
  const stats = parsePlaywrightJson(jsonFile) || parseSummary(result.out);
  const saved = writeLocalTaxonomy(run, { code: result.code, out: result.out, stats, title: `${run.source_approach} · ${run.pack_id || run.project_name}` });
  return {
    exitCode: result.code,
    logs: result.out,
    summary: { total: stats.total, passed: stats.pass, failed: stats.fail, skipped: stats.skip, details: stats.details || [] },
    command,
    reportFiles: [saved.board, saved.raw].filter(item => item && fs.existsSync(item)),
    reportPaths: { product: saved.product, board: saved.board },
  };
}

function isRemoteCdeTestPath(value) {
  const selected = String(value || '').replace(/\\/g, '/');
  return selected.startsWith('cde-tests/') || selected.startsWith('cde-db-tests/') || selected.startsWith('cde-snapshot/');
}

async function materializeCdeScript(run, pack, pool, workspace, selected) {
  const local = selected ? path.join(pack.root, selected) : '';
  if (local && fs.existsSync(local)) return local;
  if (!isRemoteCdeTestPath(selected)) return local;
  const destRoot = path.join(workspace && fs.existsSync(workspace) ? workspace : pack.root, 'cde-remote-tests');
  fs.mkdirSync(destRoot, { recursive: true });
  if (selected.startsWith('cde-db-tests/')) {
    const id = selected.split('/')[1];
    const row = await pool.query('SELECT file_name,source_code FROM test_files WHERE id=$1', [id]);
    if (!row.rowCount) throw new Error(`فایل تست CDE در دیتابیس پیدا نشد: ${selected}`);
    const dest = path.join(destRoot, row.rows[0].file_name);
    fs.writeFileSync(dest, row.rows[0].source_code || '');
    return dest;
  }
  if (!run.cde_snapshot_id) return local;
  const { files } = await loadSnapshotFiles(pool, run.cde_snapshot_id);
  let needle = selected;
  if (selected.startsWith('cde-snapshot/')) needle = selected.slice('cde-snapshot/'.length);
  else if (selected.startsWith('cde-tests/')) {
    const parts = selected.split('/');
    needle = decodeURIComponent(parts.slice(3).join('/'));
  }
  const hit = files.find(file => file.path === needle || file.path.endsWith(needle) || file.path.endsWith(path.basename(selected)));
  if (!hit) throw new Error(`فایل تست CDE در Snapshot پیدا نشد: ${selected}`);
  const dest = path.join(destRoot, path.basename(hit.path));
  fs.writeFileSync(dest, hit.code || '');
  return dest;
}

async function executeCdeRuntimeRun(run, { shouldCancel, pool, workspace, onLog }) {
  const projectKey = run.pack_id || run.cde_project_key;
  const pack = localPack.ensurePack('CDE', projectKey, { title: projectKey });
  const built = await materializeExpressRuntime(pool, run);
  const timeout = Math.max(Number(run.timeout_seconds || 180), run.tool_kind === 'PLAYWRIGHT' ? 900 : 180);
  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    CI: '1',
    PORT: String(built.port),
    AUTOMATION_RUNTIME_URL: built.baseUrl,
    BASE_URL: built.baseUrl,
    E2E_BASE_URL: built.baseUrl,
    CDE_EXPRESS_ROOT: built.appRoot,
    CDE_PROJECT_KEY: projectKey,
    PW_CHANNEL: 'chrome',
  };
  const selected = [run.test_file_path, run.tool_target]
    .map(value => String(value || '').replace(/\\/g, '/'))
    .find(value => /\.(mjs|cjs|js|ts)$/i.test(value)) || '';
  const resolved = await materializeCdeScript(run, pack, pool, workspace, selected);
  let command;
  let args;
  let cwd = pack.root;
  try {
    if (run.tool_kind === 'DANGER') {
      const script = resolved && fs.existsSync(resolved)
        ? resolved
        : (selected.endsWith('.mjs') ? path.join(pack.root, selected) : path.join(pack.root, 'scripts', 'api', 'run.mjs'));
      cwd = path.dirname(script);
      command = process.execPath;
      args = [script];
    } else if (run.tool_kind === 'K6') {
      const script = resolved && fs.existsSync(resolved)
        ? resolved
        : (selected.endsWith('.js') && !selected.endsWith('.spec.js') ? path.join(pack.root, selected) : path.join(pack.root, 'scripts', 'k6.js'));
      cwd = path.dirname(script);
      const k6 = resolveBin('k6');
      command = k6.command;
      args = ['run', path.basename(script)];
    } else if (run.tool_kind === 'VITEST') {
      const fallback = fs.existsSync(path.join(pack.root, 'scripts', 'vitest', 'runtime.test.cjs'))
        ? path.join(pack.root, 'scripts', 'vitest', 'runtime.test.cjs')
        : path.join(pack.root, 'scripts', 'unit', 'runtime.test.cjs');
      const script = resolved && fs.existsSync(resolved)
        ? resolved
        : (selected.endsWith('.cjs') || selected.endsWith('.js') ? path.join(pack.root, selected) : fallback);
      cwd = path.dirname(script);
      command = process.execPath;
      args = ['--test', script];
    } else {
      const spec = resolved && fs.existsSync(resolved)
        ? resolved
        : (/\.(spec|test)\.(ts|js|mjs)$/i.test(selected) ? path.join(pack.root, selected) : path.join(pack.root, 'scripts', 'e2e', 'health.spec.ts'));
      const job = playwrightJob({
        cwd: path.dirname(spec),
        specPath: spec,
        workspace,
        baseURL: built.baseUrl,
        headed: Boolean(run.headed),
      });
      command = job.command;
      args = job.args;
      cwd = job.cwd;
      Object.assign(env, job.envExtra);
    }
    let result;
    try {
      result = await runProcess(command, args, cwd, env, timeout, shouldCancel, onLog);
    } catch (error) {
      if (run.tool_kind === 'K6' && process.platform === 'win32') {
        result = await runProcess('k6', args, cwd, env, timeout, shouldCancel, onLog);
      } else {
        throw error;
      }
    }
    const stats = parseSummary(result.out);
    const saved = writeLocalTaxonomy(run, {
      code: result.code,
      out: result.out,
      stats,
      title: `CDE ${projectKey}`,
    });
    result.out = `${built.runtime.logs()}\n${result.out || ''}\n\n--- reports ---\n${saved.board}`.trim();
    return {
      exitCode: result.code,
      logs: result.out,
      summary: { total: stats.total, passed: stats.pass, failed: stats.fail, skipped: stats.skip, details: stats.details || [] },
      command: [command, ...args],
      reportFiles: [saved.board, saved.raw].filter(item => item && fs.existsSync(item)),
      reportPaths: { product: saved.product, board: saved.board, express: built.appRoot },
    };
  } finally {
    await built.runtime.stop();
  }
}

async function executeNonCdeRun(run, context) {
  if (run.source_approach === 'IS') return executeIsRun(run, context);
  if (run.source_approach === 'CDE') return executeCdeRuntimeRun(run, context);
  return executeSourceToolRun(run, context);
}

module.exports = { executeNonCdeRun };

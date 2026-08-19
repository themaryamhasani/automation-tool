const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { Pool } = require('pg');
const { decryptText } = require('../../../shared/snapshot-crypto.cjs');
const { excerptLogs, notifyRun } = require('../../../shared/log-excerpt.cjs');
const { executeNonCdeRun } = require('./tools.cjs');
const { writeLocalTaxonomy } = require('./local-reports.cjs');
const { enrichSummary } = require('./report-findings.cjs');
const { spawnLogged, sanitizeEnv, chromePath, prepareIsPlaywrightRuntime } = require('./process.cjs');
const { listPacks } = require('../../api/src/approaches/is/packs.cjs');
const { packPaths } = require('../../api/src/approaches/is/service.cjs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

function prepareIsPlaywrightOnBoot() {
  try {
    const e2eRoots = [];
    let docRoot;
    for (const pack of listPacks()) {
      try {
        const paths = packPaths(pack.id);
        docRoot = paths.docRoot;
        e2eRoots.push(paths.e2eCwd);
      } catch {
        /* pack folder missing on disk */
      }
    }
    const prepared = prepareIsPlaywrightRuntime({ docRoot, e2eRoots });
    console.log(JSON.stringify({
      event: 'is-playwright-prepared',
      sharedPackage: prepared.sharedPackage || null,
      restoredStashes: prepared.restored.length,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      event: 'is-playwright-prepare-skip',
      message: error && error.message,
    }));
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const runnerId = process.env.RUNNER_ID || `automation-runner-${process.pid}`;
const pollMs = Math.max(500, Number(process.env.RUNNER_POLL_INTERVAL_MS || 1500));
const concurrency = Math.max(1, Math.min(8, Number(process.env.RUNNER_CONCURRENCY || 1)));
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const artifactRoot = path.resolve(projectRoot, process.env.ARTIFACT_ROOT || 'artifacts/playwright');
const workRoot = path.resolve(projectRoot, process.env.RUN_WORK_ROOT || 'runtime/runs');
const playwrightCli = require.resolve('@playwright/test/cli');
const chromiumExecutable = process.env.CHROMIUM_EXECUTABLE_PATH || chromePath();
let stopping = false;
let active = 0;

function safeName(value) {
  return String(value || 'test.spec.js').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 180);
}

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

async function materializeSnapshot(run, workspace) {
  let result = { legacy: true, fileCount: 0 };
  if (run.cde_snapshot_id) {
    const snapshot = await pool.query('SELECT status,manifest,content_hash,file_count FROM cde_source_snapshots WHERE id=$1', [run.cde_snapshot_id]);
    if (!snapshot.rowCount || snapshot.rows[0].status !== 'READY') throw new Error('CDE snapshot is not ready.');
    const files = await pool.query('SELECT path,encrypted_source,source_hash FROM cde_snapshot_files WHERE snapshot_id=$1 ORDER BY path', [run.cde_snapshot_id]);
    if (files.rowCount !== snapshot.rows[0].file_count) throw new Error('CDE snapshot file count mismatch.');
    for (const file of files.rows) {
      const relative = String(file.path || '').replace(/\\/g, '/');
      if (!relative || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe CDE snapshot path: ${relative}`);
      const target = path.resolve(workspace, ...relative.split('/'));
      if (!target.startsWith(`${workspace}${path.sep}`)) throw new Error(`Unsafe CDE snapshot path: ${relative}`);
      const source = decryptText(file.encrypted_source);
      if (sha256(source) !== file.source_hash) throw new Error(`CDE snapshot integrity check failed: ${relative}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source, 'utf8');
    }
    result = { legacy: false, fileCount: files.rowCount, contentHash: snapshot.rows[0].content_hash, manifest: snapshot.rows[0].manifest };
  }
  const tests = path.join(workspace, 'tests');
  await fs.mkdir(tests, { recursive: true });
  const testName = safeName(path.basename(run.test_file_path || 'test.spec.js'));
  await fs.writeFile(path.join(tests, testName), run.source_snapshot || '', 'utf8');
  return { ...result, testFile: testName };
}

const CLAIM_COLUMNS = `
  r.id, r.project_id, r.environment_id, r.test_file_id, r.test_file_path,
  r.source_snapshot, r.browser_projects, r.headed, r.workers, r.retries, r.max_failures,
  r.trace, r.reporter, r.timeout_seconds, r.status, r.source_approach, r.tool_kind,
  r.tool_target, r.pack_id, r.flow_id, r.report_paths, r.cde_project_key, r.cde_snapshot_id,
  r.cde_manifest, r.requested_by,
  e.base_url, e.api_base_url, e.gateway_base_url, e.secret_references, p.name AS project_name
`;

async function claimRun() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      `SELECT ${CLAIM_COLUMNS}
         FROM runs r
         JOIN environments e ON e.id=r.environment_id
         JOIN projects p ON p.id=r.project_id
         JOIN runner_settings s ON s.id=1 AND s.enabled=true
        WHERE r.status='QUEUED'
        ORDER BY r.requested_at
        FOR UPDATE OF r SKIP LOCKED LIMIT 1`,
    );
    if (!selected.rowCount) {
      await client.query('COMMIT');
      return null;
    }
    const run = selected.rows[0];
    await client.query(
      `UPDATE runs SET status='RUNNING',runner_id=$1,started_at=now(),last_heartbeat_at=now(),updated_at=now() WHERE id=$2`,
      [runnerId, run.id],
    );
    await client.query('COMMIT');
    await notifyRun(pool, run.id);
    return run;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function configSource(run, reportPaths) {
  const reporters = [['line']];
  if (run.reporter === 'html') reporters.push(['html', { outputFolder: reportPaths.html, open: 'never' }]);
  if (run.reporter === 'junit') reporters.push(['junit', { outputFile: reportPaths.junit }]);
  reporters.push(['json', { outputFile: reportPaths.json }]);
  const projects = run.browser_projects.map(browser => ({
    name: browser,
    use: {
      browserName: browser,
      ...(browser === 'chromium' && chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
    },
  }));
  return `const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: ${JSON.stringify(reportPaths.tests)},
  outputDir: ${JSON.stringify(reportPaths.results)},
  globalTimeout: ${Number(run.timeout_seconds) * 1000},
  timeout: ${Number(run.timeout_seconds) * 1000},
  workers: ${Number(run.workers)},
  retries: ${Number(run.retries)},
  maxFailures: ${run.max_failures == null ? 0 : Number(run.max_failures)},
  reporter: ${JSON.stringify(reporters)},
  projects: ${JSON.stringify(projects)},
  use: {
    baseURL: ${JSON.stringify(run.base_url)},
    headless: ${!run.headed},
    trace: ${JSON.stringify(run.trace)},
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true
  }
});
`;
}

function resolveSecretReferences(run) {
  const references = run.secret_references && typeof run.secret_references === 'object' ? run.secret_references : {};
  const resolved = {};
  for (const [targetName, sourceName] of Object.entries(references)) {
    const value = process.env[String(sourceName)];
    if (value === undefined) throw new Error(`Runner secret reference is unavailable: ${sourceName}`);
    resolved[targetName] = value;
  }
  return resolved;
}

function collectReport(report) {
  const tests = [];
  function visitSuite(suite, parents = []) {
    const prefix = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const last = test.results?.[test.results.length - 1] || {};
        const loc = last.error?.location || last.errors?.[0]?.location || {};
        const file = spec.file || loc.file || null;
        tests.push({
          title: [...prefix, spec.title].filter(Boolean).join(' › '),
          projectName: test.projectName || '',
          outcome: test.status || last.status || 'unknown',
          duration: (test.results || []).reduce((sum, result) => sum + Number(result.duration || 0), 0),
          file: file || undefined,
          line: loc.line,
          path: file ? `${String(file).replace(/\\/g, '/')}${loc.line != null ? `:${loc.line}` : ''}` : undefined,
          error: last.error?.message || last.errors?.[0]?.message || null,
        });
      }
    }
    for (const child of suite.suites || []) visitSuite(child, prefix);
  }
  for (const suite of report?.suites || []) visitSuite(suite);
  const failed = tests.filter(test => ['unexpected', 'failed', 'timedOut', 'interrupted'].includes(test.outcome)).length;
  const skipped = tests.filter(test => test.outcome === 'skipped').length;
  const passed = Math.max(0, tests.length - failed - skipped);
  const summary = enrichSummary({
    total: tests.length,
    passed,
    failed,
    skipped,
    pass: passed,
    fail: failed,
    skip: skipped,
    summary: `${passed} passed, ${failed} failed, ${skipped} skipped`,
    details: tests.slice(0, 500).map(item => ({
      ...item,
      outcome: ['unexpected', 'failed', 'timedOut', 'interrupted'].includes(item.outcome)
        ? 'unexpected'
        : item.outcome === 'skipped' ? 'skipped' : 'expected',
    })),
  }, { toolKind: 'PLAYWRIGHT' });
  return {
    total: summary.total,
    passed: summary.passed ?? summary.pass,
    failed: summary.failed ?? summary.fail,
    skipped: summary.skipped ?? summary.skip,
    details: summary.details,
    config: report?.config ? {
      rootDir: report.config.rootDir,
      workers: report.config.workers,
      projects: report.config.projects?.map(project => project.name),
    } : undefined,
  };
}

async function zipDirectory(directory, outputFile) {
  if (!fsSync.existsSync(directory)) return false;
  const zip = new JSZip();
  async function add(current, prefix = '') {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await add(target, zipPath);
      else zip.file(zipPath, await fs.readFile(target));
    }
  }
  await add(directory);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await fs.writeFile(outputFile, buffer);
  return true;
}

async function registerArtifact(runId, kind, filePath, fileName, mimeType) {
  const stat = await fs.stat(filePath);
  const relativePath = path.relative(artifactRoot, filePath);
  await pool.query(
    `INSERT INTO artifacts (id,run_id,kind,file_name,relative_path,mime_type,size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [crypto.randomUUID(), runId, kind, fileName, relativePath, mimeType, stat.size],
  );
}

const LOG_RAM_CAP = 2 * 1024 * 1024;

function createLogSink(runId, logFile) {
  let logs = '';
  let timer = null;
  const stream = logFile ? fsSync.createWriteStream(logFile, { flags: 'a' }) : null;
  const flush = force => {
    const push = () => {
      timer = null;
      return pool.query(
        'UPDATE runs SET logs=$1, last_heartbeat_at=now(), updated_at=now() WHERE id=$2',
        [excerptLogs(logs), runId],
      ).then(() => notifyRun(pool, runId)).catch(() => undefined);
    };
    if (force) {
      if (timer) clearTimeout(timer);
      return push();
    }
    if (!timer) timer = setTimeout(() => { void push(); }, 1200);
    return undefined;
  };
  return {
    append(chunk) {
      const text = String(chunk || '');
      if (!text) return;
      if (stream) stream.write(text);
      logs += text;
      if (logs.length > LOG_RAM_CAP) logs = logs.slice(-LOG_RAM_CAP);
      flush(false);
    },
    text() { return logs; },
    async finish() {
      await flush(true);
      if (stream) await new Promise(resolve => stream.end(resolve));
      return logs;
    },
  };
}

async function executeExternalRun(run) {
  const workspace = path.resolve(workRoot, run.id);
  if (!workspace.startsWith(`${workRoot}${path.sep}`)) throw new Error('Unsafe run workspace.');
  const output = path.join(artifactRoot, run.id);
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  const started = Date.now();
  let cancelled = false;
  const heartbeat = setInterval(async () => {
    try {
      const status = await pool.query('UPDATE runs SET last_heartbeat_at=now() WHERE id=$1 RETURNING status', [run.id]);
      if (status.rows[0]?.status === 'CANCEL_REQUESTED') cancelled = true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'heartbeat-error', runId: run.id, message: error.message }));
    }
  }, 1000);
  try {
    const logFile = path.join(output, 'runner.log');
    const sink = createLogSink(run.id, logFile);
    const result = await executeNonCdeRun(run, {
      pool,
      workspace,
      shouldCancel: async () => cancelled,
      onLog: chunk => sink.append(chunk),
    });
    await sink.finish();
    await pool.query('UPDATE runs SET command=$1 WHERE id=$2', [JSON.stringify(result.command || []), run.id]);
    const logs = result.logs || sink.text() || 'Runner completed without console output.';
    if (!fsSync.existsSync(logFile) || fsSync.statSync(logFile).size === 0) {
      await fs.writeFile(logFile, logs, 'utf8');
    }
    await registerArtifact(run.id, 'LOG', logFile, 'runner.log', 'text/plain; charset=utf-8');
    for (const reportFile of result.reportFiles || []) {
      if (reportFile && fsSync.existsSync(reportFile)) {
        const copied = path.join(output, path.basename(reportFile));
        await fs.copyFile(reportFile, copied);
        await registerArtifact(run.id, 'REPORT', copied, path.basename(reportFile), 'text/plain; charset=utf-8');
      }
    }
    const summary = result.summary || { total: 0, passed: 0, failed: 0, skipped: 0, details: [] };
    const duration = Date.now() - started;
    const status = cancelled ? 'CANCELLED' : result.exitCode === 0 ? 'PASSED' : 'FAILED';
    await pool.query(
      `UPDATE runs SET status=$1,logs=$2,report=$3::jsonb,total_tests=$4,passed_tests=$5,failed_tests=$6,skipped_tests=$7,
                       completed_at=now(),duration_ms=$8,last_heartbeat_at=now(),updated_at=now(),report_paths=$9::jsonb WHERE id=$10`,
      [status, excerptLogs(logs), JSON.stringify(summary), summary.total, summary.passed, summary.failed, summary.skipped, duration, JSON.stringify(result.reportPaths || {}), run.id],
    );
    await notifyRun(pool, run.id);
    await pool.query(
      `INSERT INTO audit_logs (action,entity_type,entity_id,metadata) VALUES ('RUN_COMPLETED','RUN',$1,$2::jsonb)`,
      [run.id, JSON.stringify({ status, runnerId, durationMs: duration, toolKind: run.tool_kind, approach: run.source_approach })],
    );
  } finally {
    clearInterval(heartbeat);
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function executeRun(run) {
  if (String(run.source_approach || 'CDE') !== 'CDE' || run.tool_kind) {
    await executeExternalRun(run);
    return;
  }
  const workspace = path.resolve(workRoot, run.id);
  if (!workspace.startsWith(`${workRoot}${path.sep}`)) throw new Error('Unsafe run workspace.');
  const output = path.join(artifactRoot, run.id);
  const tests = path.join(workspace, 'tests');
  const results = path.join(workspace, 'test-results');
  const reportPaths = {
    tests,
    results,
    json: path.join(workspace, 'report.json'),
    junit: path.join(workspace, 'report.xml'),
    html: path.join(workspace, 'html-report'),
  };
  await fs.mkdir(output, { recursive: true });
  const snapshot = await materializeSnapshot(run, workspace);
  const manifestPath = path.join(output, 'cde-snapshot-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(snapshot.manifest || run.cde_manifest || snapshot, null, 2), 'utf8');
  await registerArtifact(run.id, 'CDE_SNAPSHOT', manifestPath, 'cde-snapshot-manifest.json', 'application/json');
  const configPath = path.join(workspace, 'playwright.config.cjs');
  await fs.writeFile(configPath, configSource(run, reportPaths), 'utf8');
  const testFile = path.join('tests', snapshot.testFile || safeName(path.basename(run.test_file_path || 'test.spec.js')));
  const args = [playwrightCli, 'test', '--config', configPath, testFile];
  await pool.query('UPDATE runs SET command=$1 WHERE id=$2', [JSON.stringify([process.execPath, ...args]), run.id]);
  await notifyRun(pool, run.id);

  const started = Date.now();
  let logs = '';
  let cancelled = false;
  let exitCode = null;
  const controller = new AbortController();
  const sink = createLogSink(run.id, path.join(output, 'runner.log'));
  const heartbeat = setInterval(async () => {
    try {
      const status = await pool.query('UPDATE runs SET last_heartbeat_at=now() WHERE id=$1 RETURNING status', [run.id]);
      if (status.rows[0]?.status === 'CANCEL_REQUESTED') {
        cancelled = true;
        controller.abort();
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'heartbeat-error', runId: run.id, message: error.message }));
    }
  }, 1000);

  try {
    const result = await spawnLogged(process.execPath, args, {
      cwd: workspace,
      signal: controller.signal,
      env: sanitizeEnv({
        ...process.env,
        ...resolveSecretReferences(run),
        FORCE_COLOR: '0',
        CI: '1',
        CDE_SNAPSHOT_ROOT: workspace,
        CDE_PROJECT_KEY: run.cde_project_key || '',
        AUTOMATION_WEB_BASE_URL: run.base_url || '',
        AUTOMATION_API_BASE_URL: run.api_base_url || '',
        AUTOMATION_GATEWAY_BASE_URL: run.gateway_base_url || '',
      }),
    }, chunk => sink.append(chunk));
    logs = result.out;
    exitCode = result.code;
    await sink.finish();
  } finally {
    clearInterval(heartbeat);
  }

  const logFile = path.join(output, 'runner.log');
  if (!fsSync.existsSync(logFile) || fsSync.statSync(logFile).size === 0) {
    await fs.writeFile(logFile, logs || 'Runner completed without console output.', 'utf8');
  }
  await registerArtifact(run.id, 'LOG', logFile, 'runner.log', 'text/plain; charset=utf-8');

  let summary = { total: 0, passed: 0, failed: 0, skipped: 0, details: [] };
  if (fsSync.existsSync(reportPaths.json)) {
    try {
      const raw = JSON.parse(await fs.readFile(reportPaths.json, 'utf8'));
      summary = collectReport(raw);
      const machineReport = path.join(output, 'report.json');
      await fs.copyFile(reportPaths.json, machineReport);
      if (run.reporter === 'json') await registerArtifact(run.id, 'REPORT', machineReport, 'playwright-report.json', 'application/json');
    } catch (error) {
      logs += `\nCould not parse Playwright report: ${error.message}`;
    }
  }
  if (run.reporter === 'junit' && fsSync.existsSync(reportPaths.junit)) {
    const target = path.join(output, 'playwright-report.xml');
    await fs.copyFile(reportPaths.junit, target);
    await registerArtifact(run.id, 'REPORT', target, 'playwright-report.xml', 'application/xml');
  }
  if (run.reporter === 'html' && fsSync.existsSync(reportPaths.html)) {
    const target = path.join(output, 'playwright-html-report.zip');
    await zipDirectory(reportPaths.html, target);
    await registerArtifact(run.id, 'REPORT', target, 'playwright-html-report.zip', 'application/zip');
  }
  if (fsSync.existsSync(results)) {
    const evidence = path.join(output, 'test-evidence.zip');
    if (await zipDirectory(results, evidence)) await registerArtifact(run.id, 'EVIDENCE', evidence, 'test-evidence.zip', 'application/zip');
  }

  const duration = Date.now() - started;
  const status = cancelled ? 'CANCELLED' : exitCode === 0 ? 'PASSED' : 'FAILED';
  const saved = writeLocalTaxonomy(run, {
    code: exitCode,
    out: logs,
    stats: {
      pass: summary.passed, fail: summary.failed, skip: summary.skipped, total: summary.total,
      summary: `${summary.passed} passed / ${summary.failed} failed`,
      details: summary.details || [],
    },
    title: run.cde_project_key || run.project_name,
  });
  if (saved.board && fsSync.existsSync(saved.board)) {
    const copied = path.join(output, '01-status-board.md');
    await fs.copyFile(saved.board, copied);
    await registerArtifact(run.id, 'REPORT', copied, '01-status-board.md', 'text/markdown; charset=utf-8');
  }
  await pool.query(
    `UPDATE runs SET status=$1,logs=$2,report=$3::jsonb,total_tests=$4,passed_tests=$5,failed_tests=$6,skipped_tests=$7,
                     completed_at=now(),duration_ms=$8,last_heartbeat_at=now(),updated_at=now(),report_paths=$9::jsonb WHERE id=$10`,
    [status, excerptLogs(logs), JSON.stringify(summary), summary.total, summary.passed, summary.failed, summary.skipped, duration, JSON.stringify({ product: saved.product, board: saved.board }), run.id],
  );
  await notifyRun(pool, run.id);
  await pool.query(
    `INSERT INTO audit_logs (action,entity_type,entity_id,metadata) VALUES ('RUN_COMPLETED','RUN',$1,$2::jsonb)`,
    [run.id, JSON.stringify({ status, runnerId, durationMs: duration })],
  );
  await fs.rm(workspace, { recursive: true, force: true });
}

async function failRun(run, error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
  await pool.query(
    `UPDATE runs SET status='ERROR',logs=$1,completed_at=now(),updated_at=now() WHERE id=$2`,
    [excerptLogs(message), run.id],
  ).catch(dbError => console.error(dbError));
  await notifyRun(pool, run.id);
}

async function tick() {
  if (stopping) return;
  while (active < concurrency) {
    const run = await claimRun();
    if (!run) break;
    active += 1;
    executeRun(run).catch(error => failRun(run, error)).finally(() => { active -= 1; });
  }
}

async function start() {
  await fs.mkdir(artifactRoot, { recursive: true });
  await fs.mkdir(workRoot, { recursive: true });
  prepareIsPlaywrightOnBoot();
  await pool.query(
    `UPDATE runs SET status='ERROR',logs=coalesce(logs,'') || E'\nRunner heartbeat expired.',completed_at=now(),updated_at=now()
      WHERE status='RUNNING' AND last_heartbeat_at < now() - interval '3 minutes'`,
  );
  console.log(JSON.stringify({ event: 'runner-ready', runnerId, concurrency, pollMs }));
  await tick();
  const timer = setInterval(() => tick().catch(error => console.error(error)), pollMs);
  timer.unref();
}

async function shutdown(signal) {
  stopping = true;
  console.log(JSON.stringify({ event: 'runner-shutdown', signal, active }));
  const deadline = Date.now() + 15_000;
  while (active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
  await pool.end();
  process.exit(active ? 1 : 0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

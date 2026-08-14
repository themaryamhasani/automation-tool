const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listPacks, getPack } = require('../apps/api/src/approaches/is/packs.cjs');
const { SOURCE_APPROACHES, TOOL_KINDS } = require('../apps/api/src/approaches/constants.cjs');
const { writeFlowReport, parseSummary } = require('../apps/runner/src/is-reports.cjs');

test('source approaches and tools are registered', () => {
  assert.deepEqual(Object.keys(SOURCE_APPROACHES).sort(), ['CDE', 'GITHUB', 'GIT_EDUS', 'IS', 'ZIP']);
  assert.deepEqual(Object.keys(TOOL_KINDS).sort(), ['AUDIT', 'AXE', 'BIOME', 'DANGER', 'GITLEAKS', 'K6', 'PLAYWRIGHT', 'SEMGREP', 'SPECTRAL', 'VITEST']);
});

test('IS products map to test/doc folders and listDir stays inside test/', async () => {
  const previous = process.env.IS_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'is-ui-'));
  process.env.IS_ROOT = root;
  process.env.IS_DOC_REL = 'test/doc';
  const internship = path.join(root, 'test/doc/education/internship');
  fs.mkdirSync(path.join(internship, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(internship, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(internship, '00-readme.md'), '# internship\n');
  try {
    const { products, listDir } = require('../apps/api/src/approaches/is/service.cjs');
    const rows = products();
    const intern = rows.find(row => row.id === 'INT');
    assert.ok(intern);
    assert.equal(intern.relativePath, 'doc/education/internship');
    assert.equal(intern.exists, true);
    assert.equal(intern.runnable, true);
    const dir = await listDir('doc/education/internship');
    assert.ok(dir.entries.some(entry => entry.name === 'scripts'));
    const testRoot = await listDir('');
    assert.ok(testRoot.entries.some(entry => entry.name === 'doc'));
  } finally {
    if (previous == null) delete process.env.IS_ROOT;
    else process.env.IS_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('IS packs match the four QA products and report layout', () => {
  const packs = listPacks();
  assert.deepEqual(packs.map(pack => pack.id).sort(), ['BRN', 'INT', 'PL', 'PR']);
  const internship = getPack('KR');
  assert.equal(internship.id, 'INT');
  assert.ok(internship.danger.runByFlow.includes('run-by-flow.mjs'));
  assert.ok(internship.k6.script.endsWith('.js'));
  assert.equal(internship.e2e.channel, 'chrome');
});

test('IS flow report markdown matches the test/doc contract', () => {
  const previous = process.env.IS_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'is-pack-'));
  process.env.IS_ROOT = root;
  process.env.IS_DOC_REL = 'test/doc';
  const product = path.join(root, 'test/doc/education/internship');
  fs.mkdirSync(path.join(product, 'reports/by-flow'), { recursive: true });
  try {
    const out = '--- REQ ---\n  ✓ PASS  TC-INT-REQ-080 — example\n=== SUMMARY ===\nPASS=1  FAIL=0  SKIP=0  TOTAL=1\n';
    writeFlowReport(getPack('INT'), 'REQ', { code: 0, out }, '2026-08-13 15:00');
    const md = fs.readFileSync(path.join(product, 'reports/by-flow/REQ.md'), 'utf8');
    assert.match(md, /# گزارش فلو `REQ`/);
    assert.match(md, /\| FLOW \| `REQ` \|/);
    assert.match(md, /\| PASS \| 1 \|/);
    assert.match(md, /raw\/REQ-danger\.txt/);
    assert.equal(parseSummary(out).pass, 1);
    assert.equal(parseSummary(out).details[0].title.includes('TC-INT-REQ-080'), true);
    assert.ok(fs.existsSync(path.join(product, 'reports/by-flow/raw/REQ-danger.txt')));
  } finally {
    if (previous == null) delete process.env.IS_ROOT;
    else process.env.IS_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('non-IS runs write the same report taxonomy under runtime/reports', () => {
  const previous = process.env.SOURCE_REPORT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-rep-'));
  process.env.SOURCE_REPORT_ROOT = root;
  try {
    const { writeLocalTaxonomy } = require('../apps/runner/src/local-reports.cjs');
    const out = '--- REQ ---\n  ✓ PASS  TC-X-001 — ok\n  ✗ FAIL  TC-X-002 — broken\n';
    const saved = writeLocalTaxonomy({
      source_approach: 'GITHUB', project_id: 'p1', project_name: 'demo', tool_kind: 'DANGER', flow_id: 'REQ',
    }, { code: 1, out, title: 'demo' });
    assert.ok(fs.existsSync(path.join(saved.product, '01-status-board.md')));
    assert.ok(fs.existsSync(path.join(saved.product, 'by-tool', 'danger.md')));
    assert.ok(fs.existsSync(path.join(saved.product, 'by-flow', 'REQ.md')));
    const board = fs.readFileSync(saved.board, 'utf8');
    assert.match(board, /PASS \| 1/);
    assert.match(board, /FAIL \| 1/);
    const flow = fs.readFileSync(path.join(saved.product, 'by-flow', 'REQ.md'), 'utf8');
    assert.match(flow, /# گزارش فلو `REQ`/);
    assert.ok(fs.existsSync(path.join(saved.product, 'danger-run-raw.txt')));
    assert.ok(fs.existsSync(path.join(saved.product, 'by-tool', '_index.md')));
    assert.ok(fs.existsSync(path.join(saved.product, 'by-flow', '_index.md')));
  } finally {
    if (previous == null) delete process.env.SOURCE_REPORT_ROOT;
    else process.env.SOURCE_REPORT_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CDE local pack seeds scripts and Express runtime serves /health', async () => {
  const previousPack = process.env.LOCAL_PACK_ROOT;
  const previousApp = process.env.LOCAL_APP_ROOT;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-pack-'));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-app-'));
  process.env.LOCAL_PACK_ROOT = packDir;
  process.env.LOCAL_APP_ROOT = appDir;
  const { spawn } = require('node:child_process');
  let child;
  try {
    delete require.cache[require.resolve('../apps/api/src/approaches/local-pack.cjs')];
    delete require.cache[require.resolve('../apps/api/src/cde/express-pack.cjs')];
    const localPack = require('../apps/api/src/approaches/local-pack.cjs');
    const { buildExpressPackage } = require('../apps/api/src/cde/express-pack.cjs');
    const pack = localPack.ensurePack('CDE', 'demo-app', { title: 'demo' });
    assert.ok(fs.existsSync(path.join(pack.root, 'scripts/api/run.mjs')));
    assert.ok(fs.existsSync(path.join(pack.root, 'scripts/e2e/health.spec.ts')));
    assert.ok(fs.existsSync(path.join(pack.root, 'scripts/openapi.yaml')));
    assert.ok(fs.existsSync(path.join(pack.root, 'biome.json')));
    const webUiPack = 'pages/component/medu-community/community/auth';
    const apiPack = 'ds/medu-community/announcements/load/all';
    const built = buildExpressPackage({
      projectKey: 'demo-app',
      files: [
        { path: 'data-service/packages/core/source/src/index.ts', code: 'export const ping = () => "ok";' },
        { path: `web-ui/packages/${encodeURIComponent(webUiPack)}/source/index.jsx`, code: 'export default function Auth() { return <div>community auth</div>; }' },
        { path: `api-module/packages/${encodeURIComponent(apiPack)}/source/announcements/load/all.js`, code: 'module.exports = { id: "ds/medu-community/announcements/load/all", actions: true };' },
      ],
      packages: [
        { repositoryType: 'DATA_SERVICE', packId: 'core' },
        { repositoryType: 'WEB_UI', packId: webUiPack },
        { repositoryType: 'API_MODULE', packId: apiPack },
      ],
    });
    assert.ok(fs.existsSync(path.join(built.appRoot, 'server.cjs')));
    assert.ok(fs.existsSync(path.join(built.appRoot, 'source/data-service/packages/core/build/src/index.js')));
    child = spawn(process.execPath, ['server.cjs'], {
      cwd: built.appRoot,
      env: { ...process.env, PORT: String(built.port) },
      windowsHide: true,
    });
    const started = Date.now();
    let health;
    while (Date.now() - started < 15000) {
      try {
        const response = await fetch(`${built.baseUrl}/health`);
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    assert.ok(health);
    assert.equal(health.ok, true);
    assert.equal(health.kind, 'cde-express-runtime');
    assert.equal(health.projectKey, 'demo-app');
    const catalog = await fetch(`${built.baseUrl}/__runtime/catalog`).then(item => item.json());
    assert.equal(catalog.ok, true);
    assert.ok(catalog.webUi.some(item => item.packId === webUiPack));
    assert.ok(catalog.apiModule.some(item => item.packId === apiPack));
    const ui = await fetch(`${built.baseUrl}/__runtime/ui?packId=${encodeURIComponent(webUiPack)}`);
    assert.equal(ui.ok, true);
    assert.match(await ui.text(), /community auth/);
    const api = await fetch(`${built.baseUrl}/__runtime/api-module?packId=${encodeURIComponent(apiPack)}`);
    assert.equal(api.ok, true);
    assert.match(await api.text(), /announcements/);
    const script = path.join(pack.root, 'scripts/api/runtime-surface.mjs');
    assert.equal(fs.existsSync(script), true);
    const surface = spawn(process.execPath, [script], {
      env: { ...process.env, AUTOMATION_RUNTIME_URL: built.baseUrl, CDE_PROJECT_KEY: 'demo-app' },
      windowsHide: true,
    });
    let out = '';
    surface.stdout.on('data', chunk => { out += chunk.toString('utf8'); });
    surface.stderr.on('data', chunk => { out += chunk.toString('utf8'); });
    const code = await new Promise(resolve => surface.on('close', resolve));
    assert.equal(code, 0, out);
    assert.match(out, /PASS=8/);
  } finally {
    if (child) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill('SIGKILL');
        setTimeout(resolve, 1500).unref();
      });
    }
    if (previousPack == null) delete process.env.LOCAL_PACK_ROOT;
    else process.env.LOCAL_PACK_ROOT = previousPack;
    if (previousApp == null) delete process.env.LOCAL_APP_ROOT;
    else process.env.LOCAL_APP_ROOT = previousApp;
    fs.rmSync(packDir, { recursive: true, force: true });
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test('IS can create a test folder and delete added test files', async () => {
  const previous = process.env.IS_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'is-del-'));
  process.env.IS_ROOT = root;
  process.env.IS_DOC_REL = 'test/doc';
  const scripts = path.join(root, 'test/doc/education/internship/scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(root, 'test/doc/education/internship/00-readme.md'), '# internship\n');
  try {
    delete require.cache[require.resolve('../apps/api/src/approaches/is/service.cjs')];
    const { writeTestFile, mkdirTestDir, removeTestPath, ApproachError } = require('../apps/api/src/approaches/is/service.cjs');
    const created = writeTestFile('doc/education/internship/scripts/tmp-login.spec.ts', 'export {};\n', { create: true });
    assert.equal(created.created, true);
    const folder = await mkdirTestDir('doc/education/internship/scripts/tmp-suite');
    assert.equal(folder.type, 'dir');
    await removeTestPath(created.path);
    assert.equal(fs.existsSync(path.join(scripts, 'tmp-login.spec.ts')), false);
    await removeTestPath(folder.path);
    assert.equal(fs.existsSync(path.join(scripts, 'tmp-suite')), false);
    await assert.rejects(() => removeTestPath(''), error => error instanceof ApproachError && error.code === 'IS_ROOT_PROTECTED');
    await assert.rejects(() => removeTestPath('../outside'), error => error.code === 'IS_UNSAFE_PATH');
  } finally {
    if (previous == null) delete process.env.IS_ROOT;
    else process.env.IS_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local pack can mkdir and delete added test paths without escaping the pack', async () => {
  const previous = process.env.LOCAL_PACK_ROOT;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-del-'));
  process.env.LOCAL_PACK_ROOT = packDir;
  try {
    delete require.cache[require.resolve('../apps/api/src/approaches/local-pack.cjs')];
    const localPack = require('../apps/api/src/approaches/local-pack.cjs');
    localPack.ensurePack('CDE', 'demo-del', { title: 'demo' });
    const created = localPack.writeFile('CDE', 'demo-del', 'scripts/e2e/tmp.spec.ts', 'export {};\n', { create: true });
    assert.equal(created.created, true);
    const folder = await localPack.mkdirDir('CDE', 'demo-del', 'scripts/tmp-folder');
    assert.equal(folder.path, 'scripts/tmp-folder');
    const removed = await localPack.removePath('CDE', 'demo-del', created.path);
    assert.equal(removed.deleted, true);
    await localPack.removePath('CDE', 'demo-del', folder.path);
    await assert.rejects(() => localPack.removePath('CDE', 'demo-del', ''), error => error.code === 'PACK_ROOT_PROTECTED');
    await assert.rejects(() => localPack.removePath('CDE', 'demo-del', '../outside'), error => error.code === 'PACK_UNSAFE_PATH');
  } finally {
    if (previous == null) delete process.env.LOCAL_PACK_ROOT;
    else process.env.LOCAL_PACK_ROOT = previous;
    fs.rmSync(packDir, { recursive: true, force: true });
  }
});


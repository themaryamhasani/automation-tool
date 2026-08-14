const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { isStaticTool, needsLiveRuntime, TOOL_KINDS } = require('../apps/api/src/approaches/constants.cjs');
const { resolveToolTarget, timeoutFor } = require('../apps/api/src/runs/tool-target.cjs');
const { findOnPath } = require('../apps/runner/src/process.cjs');
const { findOpenApi, runQualityTool, withSummary } = require('../apps/runner/src/quality-tools.cjs');
const { writeLocalTaxonomy, TOOL_META } = require('../apps/runner/src/local-reports.cjs');
const { listPacks } = require('../apps/api/src/approaches/is/packs.cjs');

const NEW_TOOLS = ['AUDIT', 'AXE', 'BIOME', 'GITLEAKS', 'SEMGREP', 'SPECTRAL'];

test('static vs live runtime classification', () => {
  assert.equal(isStaticTool('BIOME'), true);
  assert.equal(isStaticTool('AXE'), false);
  assert.equal(needsLiveRuntime('AXE'), true);
  assert.equal(needsLiveRuntime('GITLEAKS'), false);
  for (const id of NEW_TOOLS) assert.ok(TOOL_KINDS[id], id);
});

test('resolveToolTarget maps quality tools without a selected spec', () => {
  const defaults = {
    danger: 'scripts/api/run.mjs',
    k6: 'scripts/k6.js',
    playwright: 'scripts/e2e/health.spec.ts',
    unit: 'scripts/vitest/runtime.test.cjs',
    root: '.',
  };
  assert.equal(resolveToolTarget({ toolKind: 'BIOME', selected: '', defaults }).toolTarget, 'biome');
  assert.equal(resolveToolTarget({ toolKind: 'AXE', selected: '', defaults }).toolTarget, 'axe');
  assert.equal(resolveToolTarget({ toolKind: 'PLAYWRIGHT', selected: 'scripts/e2e/login.spec.ts', defaults }).testFilePath, 'scripts/e2e/login.spec.ts');
  assert.equal(timeoutFor('BIOME', { fallback: 120 }), 300);
  assert.equal(timeoutFor('AXE', { fallback: 120 }), 900);
});

test('IS packs expose the quality tool list', () => {
  for (const pack of listPacks()) {
    assert.ok(pack.tools.includes('BIOME'), pack.id);
    assert.ok(pack.tools.includes('SPECTRAL'), pack.id);
    assert.ok(pack.tools.includes('AXE'), pack.id);
  }
});

test('report taxonomy writes biome and spectral pages', () => {
  const previous = process.env.SOURCE_REPORT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-rep-'));
  process.env.SOURCE_REPORT_ROOT = root;
  try {
    const out = withSummary('✓ PASS  biome', { pass: 1, fail: 0, skip: 0 }).out;
    const saved = writeLocalTaxonomy({
      source_approach: 'ZIP', project_id: 'p-q', project_name: 'quality', tool_kind: 'BIOME', flow_id: 'ALL',
    }, { code: 0, out, title: 'quality' });
    assert.ok(fs.existsSync(path.join(saved.product, 'by-tool', 'biome.md')));
    assert.ok(fs.existsSync(path.join(saved.product, 'biome-raw.txt')));
    const index = fs.readFileSync(path.join(saved.product, 'by-tool', '_index.md'), 'utf8');
    assert.match(index, /gitleaks/);
    assert.match(index, /spectral/);
    assert.equal(Boolean(TOOL_META.AXE), true);
  } finally {
    if (previous == null) delete process.env.SOURCE_REPORT_ROOT;
    else process.env.SOURCE_REPORT_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Biome check passes a clean javascript file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-biome-'));
  fs.writeFileSync(path.join(dir, 'ok.js'), 'export const ping = () => "ok";\n');
  try {
    const result = await runQualityTool({ toolKind: 'BIOME', scanRoots: [dir], cwd: dir, timeout: 60 });
    assert.equal(result.fail, 0, result.out);
    assert.match(result.out, /PASS=1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Spectral lints a seeded OpenAPI file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-spec-'));
  const spec = `openapi: 3.0.3
info:
  title: Demo
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        '200':
          description: ok
`;
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), spec);
  try {
    assert.ok(findOpenApi([dir]));
    const result = await runQualityTool({ toolKind: 'SPECTRAL', scanRoots: [dir], cwd: dir, timeout: 60 });
    assert.equal(result.fail, 0, result.out);
    assert.match(result.out, /PASS=1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AUDIT skips when package.json is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-audit-'));
  try {
    const result = await runQualityTool({ toolKind: 'AUDIT', scanRoots: [dir], cwd: dir, timeout: 60 });
    assert.equal(result.fail, 0, result.out);
    assert.ok(result.skip > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gitleaks and semgrep fail closed when missing from PATH', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-bin-'));
  try {
    const gitleaks = findOnPath(process.platform === 'win32' ? ['gitleaks.exe', 'gitleaks'] : ['gitleaks']);
    if (!gitleaks) {
      await assert.rejects(
        () => runQualityTool({ toolKind: 'GITLEAKS', scanRoots: [dir], cwd: dir, timeout: 20 }),
        /gitleaks/,
      );
    }
    const semgrep = findOnPath(process.platform === 'win32' ? ['semgrep.exe', 'semgrep'] : ['semgrep']);
    if (!semgrep) {
      await assert.rejects(
        () => runQualityTool({ toolKind: 'SEMGREP', scanRoots: [dir], cwd: dir, timeout: 20 }),
        /semgrep/,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

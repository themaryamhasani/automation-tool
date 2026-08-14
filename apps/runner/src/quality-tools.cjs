const fs = require('node:fs');
const path = require('node:path');
const { isStaticTool } = require('../../api/src/approaches/constants.cjs');
const { findOnPath, npmCliJs, playwrightJob, resolveBin, runProcess } = require('./process.cjs');

const QUALITY_ROOT = path.join(__dirname, '..', 'quality');
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'coverage', 'artifacts', 'test-results', 'playwright-report', '.git', '.next', 'runtime']);

function missingBin(name, hint) {
  return new Error(`${name} روی PATH پیدا نشد. ${hint}`);
}

function resolvePackageBin(pkgName, binName) {
  const pkgPath = require.resolve(`${pkgName}/package.json`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName || Object.keys(pkg.bin || {})[0]];
  if (!binRel) throw new Error(`باینری ${binName || pkgName} در بسته ${pkgName} نیست.`);
  return path.join(path.dirname(pkgPath), binRel);
}

function existingRoots(scanRoots) {
  return [...new Set((scanRoots || []).map(item => path.resolve(item)).filter(item => item && fs.existsSync(item)))];
}

function walkFiles(root, { maxDepth = 5, maxFiles = 80, test } = {}) {
  const found = [];
  const visit = (dir, depth) => {
    if (found.length >= maxFiles || depth < 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth - 1);
      else if (!test || test(full, entry.name)) found.push(full);
    }
  };
  if (root && fs.existsSync(root)) visit(root, maxDepth);
  return found;
}

function findOpenApi(scanRoots) {
  const names = new Set(['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.yml', 'swagger.json']);
  for (const root of existingRoots(scanRoots)) {
    const direct = [...names].map(name => path.join(root, name)).find(item => fs.existsSync(item));
    if (direct) return direct;
    const nested = walkFiles(root, {
      maxDepth: 4,
      maxFiles: 20,
      test: (_full, name) => names.has(name.toLowerCase()) || /^openapi\./i.test(name),
    });
    if (nested[0]) return nested[0];
  }
  return null;
}

function findPackageJson(scanRoots) {
  const hits = [];
  for (const root of existingRoots(scanRoots)) {
    const direct = path.join(root, 'package.json');
    if (fs.existsSync(direct)) hits.push(path.dirname(direct));
    for (const file of walkFiles(root, { maxDepth: 3, maxFiles: 12, test: (_full, name) => name === 'package.json' })) {
      const dir = path.dirname(file);
      if (!hits.includes(dir)) hits.push(dir);
    }
  }
  return hits;
}

function withSummary(out, { pass = 0, fail = 0, skip = 0, code = 0 } = {}) {
  const summary = `=== SUMMARY ===\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}  TOTAL=${pass + fail + skip}`;
  return { out: `${String(out || '').trim()}\n\n${summary}\n`, code: fail > 0 ? (code || 1) : 0, pass, fail, skip };
}

async function runLogged(command, args, cwd, env, timeout, shouldCancel, onLog) {
  return runProcess(command, args, cwd, env, timeout, shouldCancel, onLog);
}

function biomeCommand() {
  const bin = resolvePackageBin('@biomejs/biome', 'biome');
  return { command: process.execPath, args: [bin] };
}

function spectralCommand() {
  const bin = resolvePackageBin('@stoplight/spectral-cli', 'spectral');
  return { command: process.execPath, args: [bin] };
}

async function runBiome({ scanRoots, timeout, shouldCancel, onLog, env }) {
  const roots = existingRoots(scanRoots);
  if (!roots.length) return withSummary('پوشه‌ای برای lint پیدا نشد.', { skip: 1 });
  const biome = biomeCommand();
  const args = [...biome.args, 'check', '--formatter-enabled=false', '--colors=off', `--config-path=${QUALITY_ROOT}`, ...roots];
  const result = await runLogged(biome.command, args, roots[0], env, timeout, shouldCancel, onLog);
  const fail = result.code ? 1 : 0;
  return withSummary(result.out, { pass: fail ? 0 : 1, fail, code: result.code });
}

async function runGitleaks({ scanRoots, timeout, shouldCancel, onLog, env }) {
  const exe = findOnPath(process.platform === 'win32' ? ['gitleaks.exe', 'gitleaks'] : ['gitleaks']);
  if (!exe) throw missingBin('gitleaks', 'از https://github.com/gitleaks/gitleaks/releases نصب کنید؛ مثل k6 روی PATH باشد.');
  const roots = existingRoots(scanRoots);
  if (!roots.length) return withSummary('پوشه‌ای برای اسکن secret پیدا نشد.', { skip: 1 });
  let combined = '';
  let leaks = 0;
  let errors = 0;
  for (const root of roots) {
    const args = ['detect', '--no-git', '--no-banner', '--source', root, '--exit-code', '1'];
    const config = path.join(root, '.gitleaks.toml');
    if (fs.existsSync(config)) args.push('--config', config);
    const resolved = resolveBin(exe);
    const result = await runLogged(resolved.command, [...resolved.prefix, ...args], root, env, timeout, shouldCancel, onLog);
    combined += `\n--- ${root} ---\n${result.out || ''}`;
    if (result.code === 1) leaks += 1;
    else if (result.code) errors += 1;
  }
  if (errors && !leaks) return withSummary(combined, { fail: 1, code: 1 });
  return withSummary(combined, { pass: leaks ? 0 : 1, fail: leaks ? 1 : 0, code: leaks ? 1 : 0 });
}

function parseNpmAudit(text) {
  try {
    const data = JSON.parse(text);
    const meta = data.metadata?.vulnerabilities || {};
    return {
      critical: Number(meta.critical || 0),
      high: Number(meta.high || 0),
      moderate: Number(meta.moderate || 0),
      low: Number(meta.low || 0),
    };
  } catch {
    return null;
  }
}

async function runAudit({ scanRoots, timeout, shouldCancel, onLog, env }) {
  const npm = npmCliJs();
  if (!npm) throw new Error('npm پیدا نشد؛ برای SCA لازم است.');
  const packages = findPackageJson(scanRoots);
  const chunks = [];
  let fail = 0;
  let skip = 0;
  if (!packages.length) {
    chunks.push('○ SKIP  npm audit — package.json پیدا نشد');
    skip += 1;
  }
  for (const cwd of packages) {
    const result = await runLogged(process.execPath, [npm, 'audit', '--json', '--omit=dev'], cwd, env, timeout, shouldCancel, onLog);
    const stats = parseNpmAudit(result.out);
    chunks.push(`--- npm audit ${cwd} ---`);
    if (!stats) {
      chunks.push(result.out || `exit ${result.code}`);
      if (result.code) fail += 1;
      continue;
    }
    const serious = stats.critical + stats.high;
    chunks.push(`critical=${stats.critical} high=${stats.high} moderate=${stats.moderate} low=${stats.low}`);
    if (serious) {
      fail += 1;
      chunks.push(`✗ FAIL  ${serious} آسیب‌پذیری high/critical`);
    } else {
      chunks.push('✓ PASS  npm audit (high/critical=0)');
    }
  }
  const extras = [
    { names: process.platform === 'win32' ? ['osv-scanner.exe', 'osv-scanner'] : ['osv-scanner'], args: ['-r', '.'], label: 'osv-scanner' },
    { names: process.platform === 'win32' ? ['trivy.exe', 'trivy'] : ['trivy'], args: ['fs', '--severity', 'HIGH,CRITICAL', '--exit-code', '1', '--quiet', '.'], label: 'trivy' },
  ];
  const root = existingRoots(scanRoots)[0];
  for (const extra of extras) {
    const exe = findOnPath(extra.names);
    if (!exe || !root) {
      chunks.push(`○ SKIP  ${extra.label} — روی PATH نیست`);
      skip += 1;
      continue;
    }
    const resolved = resolveBin(exe);
    const result = await runLogged(resolved.command, [...resolved.prefix, ...extra.args], root, env, timeout, shouldCancel, onLog);
    chunks.push(`--- ${extra.label} ---\n${result.out || ''}`.trim());
    if (result.code) {
      fail += 1;
      chunks.push(`✗ FAIL  ${extra.label} exit ${result.code}`);
    } else {
      chunks.push(`✓ PASS  ${extra.label}`);
    }
  }
  const pass = fail ? 0 : (packages.length ? 1 : 0);
  return withSummary(chunks.join('\n'), { pass, fail, skip, code: fail ? 1 : 0 });
}

async function runSemgrep({ scanRoots, timeout, shouldCancel, onLog, env }) {
  const exe = findOnPath(process.platform === 'win32' ? ['semgrep.exe', 'semgrep'] : ['semgrep']);
  if (!exe) throw missingBin('semgrep', 'با pipx/pip نصب کنید: pipx install semgrep');
  const roots = existingRoots(scanRoots);
  if (!roots.length) return withSummary('پوشه‌ای برای SAST پیدا نشد.', { skip: 1 });
  const rules = path.join(QUALITY_ROOT, 'semgrep.yml');
  const args = [
    'scan', '--error', '--metrics=off', '--disable-version-check',
    '--config', rules, '--exclude', 'node_modules', '--exclude', 'dist', ...roots,
  ];
  const resolved = resolveBin(exe);
  const result = await runLogged(resolved.command, [...resolved.prefix, ...args], roots[0], env, timeout, shouldCancel, onLog);
  const fail = result.code ? 1 : 0;
  return withSummary(result.out, { pass: fail ? 0 : 1, fail, code: result.code });
}

async function runSpectral({ scanRoots, timeout, shouldCancel, onLog, env }) {
  const spec = findOpenApi(scanRoots);
  if (!spec) return withSummary('○ SKIP  OpenAPI/Swagger پیدا نشد.', { skip: 1 });
  const spectral = spectralCommand();
  const ruleset = path.join(QUALITY_ROOT, '.spectral.yaml');
  const args = [...spectral.args, 'lint', spec, '--ruleset', ruleset];
  const result = await runLogged(spectral.command, args, path.dirname(spec), env, timeout, shouldCancel, onLog);
  const fail = result.code ? 1 : 0;
  return withSummary(`${spec}\n${result.out}`, { pass: fail ? 0 : 1, fail, code: result.code });
}

function axeJob({ workspace, baseURL, headed }) {
  const dir = workspace && fs.existsSync(workspace) ? workspace : require('node:os').tmpdir();
  const spec = path.join(dir, 'axe.spec.cjs');
  const nodeModules = path.join(path.dirname(require.resolve('@playwright/test/package.json')), '..');
  const nodePath = [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  fs.writeFileSync(spec, `'use strict';
const { test, expect } = require('@playwright/test');
const axe = require('@axe-core/playwright');
const AxeBuilder = axe.default || axe.AxeBuilder || axe;

test('wcag a11y', async ({ page }) => {
  const base = process.env.AUTOMATION_RUNTIME_URL || process.env.E2E_BASE_URL || process.env.BASE_URL || ${JSON.stringify(baseURL || 'http://127.0.0.1')};
  await page.goto(String(base).replace(/\\/$/, '') || '/');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
`, 'utf8');
  const job = playwrightJob({ cwd: dir, specPath: spec, workspace: dir, baseURL, headed });
  job.envExtra = { ...job.envExtra, NODE_PATH: nodePath };
  return job;
}

async function runQualityTool({ toolKind, scanRoots, cwd, timeout, shouldCancel, onLog, env }) {
  const kind = String(toolKind || '').toUpperCase();
  const roots = existingRoots(scanRoots && scanRoots.length ? scanRoots : [cwd]);
  const context = { scanRoots: roots, timeout, shouldCancel, onLog, env };
  if (kind === 'BIOME') return runBiome(context);
  if (kind === 'GITLEAKS') return runGitleaks(context);
  if (kind === 'AUDIT') return runAudit(context);
  if (kind === 'SEMGREP') return runSemgrep(context);
  if (kind === 'SPECTRAL') return runSpectral(context);
  throw new Error(`ابزار کیفیت پشتیبانی نمی‌شود: ${kind}`);
}

module.exports = {
  QUALITY_ROOT,
  isStaticTool,
  findOpenApi,
  findPackageJson,
  withSummary,
  resolvePackageBin,
  axeJob,
  runQualityTool,
};

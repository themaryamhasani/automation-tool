const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  preparePlaywrightEnv,
  cookiesFromHeader,
  storageStateHasCookies,
} = require('../../apps/runner/src/playwright-env.cjs');
const { parseSummary } = require('../../apps/runner/src/is-reports.cjs');

test('preparePlaywrightEnv aliases instance ids and discovers parent storageState', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-env-'));
  const auth = path.join(root, '.auth');
  fs.mkdirSync(auth);
  const stored = path.join(auth, 'parent.json');
  fs.writeFileSync(stored, JSON.stringify({ cookies: [{ name: 'sso', value: 'tok' }], origins: [] }));
  try {
    const env = preparePlaywrightEnv({
      G10_INSTANCE_ID: 'inst-1',
      MID_INSTANCE_ID: 'inst-2',
    }, { searchDirs: [root], workspace: root });
    assert.equal(env.E2E_G10_INSTANCE_ID, 'inst-1');
    assert.equal(env.E2E_MID_INSTANCE_ID, 'inst-2');
    assert.equal(storageStateHasCookies(env.E2E_STORAGE_STATE_PARENT), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preparePlaywrightEnv writes storageState from PREREG_COOKIE', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cookie-'));
  try {
    const env = preparePlaywrightEnv({
      G10_INSTANCE_ID: 'inst-1',
      PREREG_COOKIE: 'sso=abc; session=xyz',
      E2E_BASE_URL: 'http://localhost:3014/student-pre-registration/',
    }, { searchDirs: [root], workspace: root });
    assert.equal(storageStateHasCookies(env.E2E_STORAGE_STATE_PARENT), true);
    const state = JSON.parse(fs.readFileSync(env.E2E_STORAGE_STATE_PARENT, 'utf8'));
    assert.equal(state.cookies.length, 2);
    assert.equal(state.cookies[0].name, 'sso');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preparePlaywrightEnv recovers UTF-8 BOM corrupted parent.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-bom-'));
  const auth = path.join(root, '.auth');
  fs.mkdirSync(auth);
  const stored = path.join(auth, 'parent.json');
  const json = JSON.stringify({ cookies: [{ name: '_lsr', value: 'tok' }], origins: [] });
  fs.writeFileSync(stored, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(json, 'utf8')]));
  try {
    assert.equal(storageStateHasCookies(stored), true);
    const env = preparePlaywrightEnv({
      E2E_STORAGE_STATE_PARENT: './.auth/parent.json',
    }, { searchDirs: [root], workspace: root });
    assert.equal(storageStateHasCookies(env.E2E_STORAGE_STATE_PARENT), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preparePlaywrightEnv drops empty storageState without inventing a fake login', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-empty-'));
  const empty = path.join(root, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({ cookies: [], origins: [] }));
  try {
    const env = preparePlaywrightEnv({
      G10_INSTANCE_ID: 'inst-1',
      E2E_STORAGE_STATE_PARENT: empty,
    }, { searchDirs: [root], workspace: root });
    assert.equal(env.E2E_STORAGE_STATE_PARENT, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cookiesFromHeader parses a Cookie header', () => {
  const cookies = cookiesFromHeader('a=1; b=2', 'https://example.test/app');
  assert.equal(cookies.length, 2);
  assert.equal(cookies[1].name, 'b');
  assert.equal(cookies[1].secure, true);
});

test('generated Playwright config applies parent storageState from env', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../apps/runner/src/process.cjs'), 'utf8');
  assert.match(source, /storageState: process\.env\.E2E_STORAGE_STATE_PARENT \|\| process\.env\.E2E_STORAGE_STATE \|\| undefined/);
});

test('IS Playwright prefers the pack playwright.config like a local npm run', () => {
  const tools = fs.readFileSync(path.resolve(__dirname, '../../apps/runner/src/tools.cjs'), 'utf8');
  assert.match(tools, /findRepoPlaywrightConfig\(paths\.e2eCwd\)/);
  assert.match(tools, /playwrightRepoJob/);
  assert.doesNotMatch(tools, /assertParentPlaywrightAuth/);
});

test('resolvePlaywrightInstall prefers outermost install and stashes nested Playwright copies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-dual-'));
  const nested = path.join(root, 'doc', 'pack', 'scripts', 'e2e');
  const mkCli = (dir) => {
    const cli = path.join(dir, 'node_modules', '@playwright', 'test', 'cli.js');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, 'module.exports = {};\n');
  };
  try {
    mkCli(root);
    mkCli(nested);
    const { resolvePlaywrightInstall, playwrightRepoJob } = require('../../apps/runner/src/process.cjs');
    const install = resolvePlaywrightInstall(nested);
    assert.equal(install.dual, true);
    assert.equal(install.root, root);
    assert.deepEqual(install.stashRoots, [nested]);
    assert.equal(install.cli, path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'));

    fs.writeFileSync(path.join(nested, 'playwright.config.ts'), 'export default {};\n');
    const job = playwrightRepoJob({ sourceRoot: nested, workspace: root });
    assert.match(job.args[0], /automation-playwright-launch\.cjs$/);
    assert.match(fs.readFileSync(job.args[0], 'utf8'), /__automation_pw_stash/);
    assert.equal(job.args[1], 'test');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolvePlaywrightInstall keeps a single nested install without a resolve hook', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-single-'));
  const nested = path.join(root, 'scripts', 'e2e');
  const cli = path.join(nested, 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, 'module.exports = {};\n');
  fs.writeFileSync(path.join(nested, 'playwright.config.ts'), 'export default {};\n');
  try {
    const { resolvePlaywrightInstall, playwrightRepoJob } = require('../../apps/runner/src/process.cjs');
    const install = resolvePlaywrightInstall(nested);
    assert.equal(install.dual, false);
    assert.equal(install.root, nested);
    const job = playwrightRepoJob({ sourceRoot: nested, workspace: root });
    assert.equal(job.args.includes('-r'), false);
    assert.equal(job.args[0], cli);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureSharedEsmPackage writes type:module next to checklist helpers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-shared-esm-'));
  const e2e = path.join(root, 'doc', 'pack', 'scripts', 'e2e');
  const shared = path.join(root, 'doc', '_shared');
  fs.mkdirSync(e2e, { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, 'e2e-checklist-helpers.ts'), 'export const x = 1;\n');
  try {
    const { ensureSharedEsmPackage } = require('../../apps/runner/src/process.cjs');
    const pkgPath = ensureSharedEsmPackage(e2e);
    assert.equal(pkgPath, path.join(shared, 'package.json'));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.type, 'module');
    // second call is idempotent
    assert.equal(ensureSharedEsmPackage(e2e), pkgPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepareIsPlaywrightRuntime restores leftover dual-install stashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-stash-'));
  const e2e = path.join(root, 'scripts', 'e2e');
  const nm = path.join(e2e, 'node_modules');
  const live = path.join(nm, 'playwright');
  const stash = `${live}.__automation_pw_stash`;
  fs.mkdirSync(stash, { recursive: true });
  fs.writeFileSync(path.join(stash, 'marker.txt'), 'ok\n');
  const shared = path.join(root, '_shared');
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, 'e2e-checklist-helpers.ts'), 'export const x = 1;\n');
  try {
    const { prepareIsPlaywrightRuntime } = require('../../apps/runner/src/process.cjs');
    const prepared = prepareIsPlaywrightRuntime({ docRoot: root, e2eRoots: [e2e] });
    assert.ok(prepared.sharedPackage);
    assert.equal(fs.existsSync(live), true);
    assert.equal(fs.existsSync(stash), false);
    assert.equal(fs.readFileSync(path.join(live, 'marker.txt'), 'utf8').trim(), 'ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runner boots IS Playwright prepare and npm predev wires the script', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../../apps/runner/src/main.cjs'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  assert.match(main, /prepareIsPlaywrightOnBoot/);
  assert.match(main, /is-playwright-prepared/);
  assert.equal(pkg.scripts.predev, 'node scripts/prepare-is-playwright.cjs');
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../scripts/prepare-is-playwright.cjs')), true);
});

test('web vite keeps a strict localhost port so proxy login does not drift', () => {
  const vite = fs.readFileSync(path.resolve(__dirname, '../../apps/web/vite.config.ts'), 'utf8');
  assert.match(vite, /port:\s*5180/);
  assert.match(vite, /strictPort:\s*true/);
  assert.match(vite, /target:\s*process\.env\.API_BASE_URL \|\| 'http:\/\/localhost:4280'/);
});

test('parseSummary treats Playwright skip dashes as SKIP not FAIL', () => {
  const out = `
Running 1 test using 1 worker

  -  1 [chromium] › specs\\g10-eligibility-gate.spec.ts:39:3 › G10 eligibility gate UI › TC-PR-G10-002

  1 skipped
`;
  const stats = parseSummary(out);
  assert.equal(stats.fail, 0);
  assert.equal(stats.skip, 1);
  assert.equal(stats.details[0].outcome, 'skipped');
});

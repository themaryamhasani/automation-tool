const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const localPack = require('../../shared/approaches/local-pack.cjs');
const { k6CliArgs, normalizeToolOptions } = require('../../shared/tool-options.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const TAVAN = path.join(ROOT, 'runtime', 'packs', 'cde', 'tavan');

test('tavan pack has layered k6 + SEC coverage paths', () => {
  const required = [
    'scripts/api/run.mjs',
    'scripts/k6/_client.js',
    'scripts/k6/health.js',
    'scripts/k6/load.js',
    'scripts/k6/security-perf.js',
    'flows/SEC__tavan.security.v1.md',
    'flows/AUTH__tavan.auth.v1.md',
    'flows/TBL__tavan.grid.v1.md',
    'flows/PERF__tavan.perf.v1.md',
    'data/catalog.json',
  ];
  for (const rel of required) {
    assert.equal(fs.existsSync(path.join(TAVAN, rel)), true, `missing ${rel}`);
  }
  const run = fs.readFileSync(path.join(TAVAN, 'scripts/api/run.mjs'), 'utf8');
  assert.match(run, /ds\/tavan\/app\/load|app\.load/);
  assert.match(run, /bank\.folder\.load|bank\/folder\/load/);
  assert.doesNotMatch(run, /ds\/tavan\/grid\/load/);
  assert.doesNotMatch(run, /module gap — wire CDE snapshot/);
  for (const tc of ['TC-TAVAN-SEC-090', 'TC-TAVAN-SEC-093', 'TC-TAVAN-SEC-094', 'TC-TAVAN-SEC-095', 'TC-TAVAN-SEC-096']) {
    assert.match(run, new RegExp(tc));
  }
  const load = fs.readFileSync(path.join(TAVAN, 'scripts/k6/load.js'), 'utf8');
  assert.match(load, /PREREG_COOKIE|requireRuntimeAuth|hasRuntimeAuth/);
  assert.match(load, /sessions\/list/);
  assert.match(load, /quizzes\/list/);
  assert.match(load, /join-exam|hold-sessions|course-context/);
  assert.doesNotMatch(load, /['"`][^'"`]*devlogin[^'"`]*['"`]/);
  assert.doesNotMatch(load, /pwsp--medu--sso/);
  const client = fs.readFileSync(path.join(TAVAN, 'scripts/k6/_client.js'), 'utf8');
  assert.match(client, /AUTOMATION_RUNTIME_URL/);
  assert.match(client, /PREREG_COOKIE/);
  assert.doesNotMatch(client, /['"`][^'"`]*devlogin[^'"`]*['"`]/);
});

test('defaultK6Path prefers scripts/k6/load.js', () => {
  const rel = localPack.defaultK6Path('CDE', 'tavan');
  assert.equal(rel, 'scripts/k6/load.js');
});

test('ensurePack merges pack.json and does not wipe target fields', () => {
  const os = require('node:os');
  const previous = process.env.LOCAL_PACK_ROOT;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-merge-'));
  process.env.LOCAL_PACK_ROOT = tmp;
  delete require.cache[require.resolve('../../shared/approaches/local-pack.cjs')];
  const packApi = require('../../shared/approaches/local-pack.cjs');
  const key = `merge-demo-${Date.now()}`;
  try {
    const root = packApi.packRoot('CDE', key);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'pack.json'), JSON.stringify({
      approach: 'CDE',
      key,
      title: 'Merge Demo',
      preferredOrigin: 'https://soha.m.edus.ir',
      projectServiceId: 'demo.medu.ir',
      appPath: '/demo',
    }, null, 2));
    const pack = packApi.ensurePack('CDE', key, { title: 'ignored' });
    assert.equal(pack.preferredOrigin, 'https://soha.m.edus.ir');
    assert.equal(pack.projectServiceId, 'demo.medu.ir');
    assert.equal(pack.appPath, '/demo');
    assert.equal(pack.title, 'Merge Demo');
    assert.equal(fs.existsSync(path.join(root, 'scripts/k6/load.js')), true);
  } finally {
    if (previous == null) delete process.env.LOCAL_PACK_ROOT;
    else process.env.LOCAL_PACK_ROOT = previous;
    delete require.cache[require.resolve('../../shared/approaches/local-pack.cjs')];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('k6CliArgs used for CDE-style options', () => {
  const opts = normalizeToolOptions('K6', { vus: 10, duration: '2m', httpDebug: true });
  assert.deepEqual(k6CliArgs('load.js', opts), ['run', '--vus', '10', '--duration', '2m', '--http-debug', 'load.js']);
});

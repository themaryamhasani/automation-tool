const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { scaffoldCdePack, packRoot, overlayRoot } = require('../../scripts/lib/cde-pack-scaffold.cjs');
const { main: seedMain, DEFS } = require('../../scripts/seed-cde-pack.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

test('phase 7 scaffold and thin seed entrypoints exist', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/lib/cde-pack-scaffold.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/seed-cde-pack.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/pack-defs/tavan.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/pack-defs/medu-camp.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/pack-overlays/tavan/scripts/api/run.mjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/pack-overlays/medu-camp/scripts/api/run.mjs')), true);
  const tavanSeed = fs.readFileSync(path.join(ROOT, 'scripts/seed-tavan-pack.cjs'), 'utf8');
  const campSeed = fs.readFileSync(path.join(ROOT, 'scripts/seed-medu-camp-pack.cjs'), 'utf8');
  assert.match(tavanSeed, /seed-cde-pack\.cjs/);
  assert.match(campSeed, /seed-cde-pack\.cjs/);
  assert.ok(tavanSeed.split(/\n/).length < 20, 'tavan seed must stay thin');
  assert.ok(campSeed.split(/\n/).length < 20, 'medu-camp seed must stay thin');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(String(pkg.scripts?.['seed:pack'] || ''), /seed-cde-pack/);
});

test('scaffold writes pack.json and copies overlays', () => {
  const key = `scaffold-demo-${Date.now()}`;
  const result = scaffoldCdePack({
    key,
    title: 'Scaffold Demo',
    target: { preferredOrigin: 'https://soha.m.edus.ir', appPath: '/demo' },
    files: { '00-readme.md': '# demo\n' },
    copyOverlay: false,
  });
  try {
    assert.equal(result.key, key);
    assert.equal(fs.existsSync(path.join(result.root, 'pack.json')), true);
    assert.equal(fs.existsSync(path.join(result.root, 'scripts/e2e/health.spec.ts')), true);
    assert.equal(fs.existsSync(path.join(result.root, 'biome.json')), true);
    const pack = JSON.parse(fs.readFileSync(path.join(result.root, 'pack.json'), 'utf8'));
    assert.equal(pack.key, key);
    assert.equal(pack.appPath, '/demo');
  } finally {
    fs.rmSync(result.root, { recursive: true, force: true });
  }
});

test('known pack defs seed through generator without throwing', () => {
  assert.deepEqual(Object.keys(DEFS).sort(), ['medu-camp', 'tavan']);
  for (const key of Object.keys(DEFS)) {
    assert.equal(fs.existsSync(overlayRoot(key)), true);
    assert.equal(fs.existsSync(packRoot('CDE', key)), true);
  }
  // Re-seed into existing packs (idempotent enough for contract check).
  const results = seedMain(['tavan']);
  assert.equal(results[0].key, 'tavan');
  assert.ok(results[0].overlayFiles >= 1);
  assert.equal(fs.existsSync(path.join(results[0].root, 'scripts/api/run.mjs')), true);
});

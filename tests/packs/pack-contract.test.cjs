const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { listPackTargetOverlays, loadRegistryMap, PACKS_ROOT } = require('../../shared/runtime/target-registry.cjs');
const { resolveAppTarget, getAppTarget } = require('../../shared/runtime/app-targets.cjs');

const REQUIRED_FOLDERS = ['scripts/api', 'reports'];
const RUNNABLE_ENTRY = 'scripts/api/run.mjs';

function listPackDirs() {
  if (!fs.existsSync(PACKS_ROOT)) return [];
  const packs = [];
  for (const approach of fs.readdirSync(PACKS_ROOT, { withFileTypes: true })) {
    if (!approach.isDirectory()) continue;
    const approachRoot = path.join(PACKS_ROOT, approach.name);
    for (const packDir of fs.readdirSync(approachRoot, { withFileTypes: true })) {
      if (!packDir.isDirectory()) continue;
      packs.push({
        approach: approach.name,
        key: packDir.name,
        root: path.join(approachRoot, packDir.name),
      });
    }
  }
  return packs;
}

test('every local pack has pack.json with approach and key', () => {
  const packs = listPackDirs().filter((pack) => fs.existsSync(path.join(pack.root, 'pack.json')));
  assert.ok(packs.length >= 1, 'expected at least one runtime pack');
  for (const pack of packs) {
    const file = path.join(pack.root, 'pack.json');
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(info.key || pack.key, pack.key);
    assert.ok(info.approach || pack.approach, pack.key);
  }
});

test('runnable packs expose danger entry and report folders', () => {
  for (const pack of listPackDirs()) {
    if (!fs.existsSync(path.join(pack.root, 'pack.json'))) continue;
    const entry = path.join(pack.root, RUNNABLE_ENTRY);
    if (!fs.existsSync(entry)) continue;
    for (const folder of REQUIRED_FOLDERS) {
      assert.equal(fs.existsSync(path.join(pack.root, folder)), true, `${pack.key}/${folder}`);
    }
    const packJson = JSON.parse(fs.readFileSync(path.join(pack.root, 'pack.json'), 'utf8'));
    if (packJson.preferredOrigin || packJson.projectServiceId) {
      const target = resolveAppTarget(packJson.key || pack.key);
      assert.ok(target.origin || target.projectServiceId || target.appPath, pack.key);
    }
  }
});

test('registry keys resolve without hard-coded APP_TARGETS object literal', () => {
  const registry = loadRegistryMap();
  assert.ok(registry['medu-camp']);
  assert.ok(registry.tavan);
  assert.ok(registry['medu-community']);
  const source = fs.readFileSync(path.resolve(__dirname, '../../shared/runtime/app-targets.cjs'), 'utf8');
  assert.doesNotMatch(source, /const APP_TARGETS\s*=\s*\{/);
  assert.match(source, /targets-registry\.json|loadRegistryMap|loadMergedTargets/);
  for (const key of Object.keys(registry)) {
    assert.ok(getAppTarget(key), key);
    assert.equal(resolveAppTarget(key).projectKey, key);
  }
});

test('pack overlays are discoverable for CDE packs with target fields', () => {
  const overlays = listPackTargetOverlays();
  assert.ok(overlays.some((row) => ['medu-camp', 'tavan', 'medu-community'].includes(row.packKey)));
});

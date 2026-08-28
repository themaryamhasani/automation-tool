const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldKeepRuntimePackage, savedIdsFor } = require('../../apps/api/src/cde/snapshot-focus.cjs');

test('runtime snapshot keeps selected Web UI pack and drops the rest', () => {
  const savedIds = savedIdsFor('WEB_UI', [{ repository_type: 'WEB_UI', pack_id: 'pages/community' }]);
  assert.equal(shouldKeepRuntimePackage('WEB_UI', 'pages/community', { savedIds }).keep, true);
  assert.equal(shouldKeepRuntimePackage('WEB_UI', 'pages/other', { savedIds }).keep, false);
});

test('runtime snapshot keeps focused API modules even when another pack is selected', () => {
  const savedIds = savedIdsFor('API_MODULE', [{ repository_type: 'API_MODULE', pack_id: 'other-service' }]);
  assert.equal(shouldKeepRuntimePackage('API_MODULE', 'auth', { savedIds }).keep, true);
  assert.equal(shouldKeepRuntimePackage('API_MODULE', 'unrelated-billing', { savedIds, apiKept: 8 }).keep, false);
});

test('without a selection, extra Web UI packs are trimmed after two', () => {
  assert.equal(shouldKeepRuntimePackage('WEB_UI', 'pages/misc', { webKept: 0 }).keep, true);
  assert.equal(shouldKeepRuntimePackage('WEB_UI', 'pages/misc', { webKept: 2 }).keep, false);
  assert.equal(shouldKeepRuntimePackage('WEB_UI', 'pages/component/medu-community/community/auth', { webKept: 9 }).keep, true);
});

test('CDE_SNAPSHOT_WEB_FOCUS overrides the default community regex', () => {
  const previous = process.env.CDE_SNAPSHOT_WEB_FOCUS;
  process.env.CDE_SNAPSHOT_WEB_FOCUS = 'billing-only';
  try {
    assert.equal(shouldKeepRuntimePackage('WEB_UI', 'pages/billing-only', { webKept: 9 }).keep, true);
    assert.equal(shouldKeepRuntimePackage('WEB_UI', 'pages/community', { webKept: 9 }).keep, false);
  } finally {
    if (previous == null) delete process.env.CDE_SNAPSHOT_WEB_FOCUS;
    else process.env.CDE_SNAPSHOT_WEB_FOCUS = previous;
  }
});

test('required dependency ids bypass web trim and selection filters', () => {
  const requiredIds = new Set(['parham/lib/packs/translate']);
  assert.equal(shouldKeepRuntimePackage('WEB_UI', 'parham/lib/packs/translate', { requiredIds, webKept: 99 }).keep, true);
  const savedIds = new Set(['pages/other']);
  assert.equal(
    shouldKeepRuntimePackage('WEB_UI', 'pages/component/tavan/components/BForm', {
      savedIds,
      requiredIds: new Set(['tavan/components/BForm']),
    }).keep,
    true,
  );
});

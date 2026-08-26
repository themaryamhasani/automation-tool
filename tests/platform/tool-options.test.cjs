const assert = require('node:assert/strict');
const test = require('node:test');
const {
  defaultToolOptions,
  normalizeToolOptions,
  normalizeRunToolConfig,
  snapshotWithToolOptions,
  k6CliArgs,
  vitestCliArgs,
  parseExtraHeaders,
  auditSeriousCount,
  ToolOptionsError,
} = require('../../shared/tool-options.cjs');

test('default and normalize k6 options', () => {
  const defaults = defaultToolOptions('K6');
  assert.equal(defaults.vus, 1);
  const normalized = normalizeToolOptions('K6', { vus: 5, duration: '1m', httpDebug: true });
  assert.deepEqual(k6CliArgs('load.js', normalized), ['run', '--vus', '5', '--duration', '1m', '--http-debug', 'load.js']);
});

test('normalize playwright run config maps browser and retries', () => {
  const config = normalizeRunToolConfig('PLAYWRIGHT', {
    browserProjects: ['chromium', 'firefox'],
    retries: 2,
    workers: 4,
    toolOptions: { channel: 'msedge', extraHeaders: '{"X-Test":"1"}' },
  }, { default_timeout_seconds: 120, default_workers: 1, default_retries: 0, default_trace: 'off', default_reporter: 'json' });
  assert.deepEqual(config.browsers, ['chromium', 'firefox']);
  assert.equal(config.retries, 2);
  assert.equal(config.toolOptions.channel, 'msedge');
  assert.deepEqual(parseExtraHeaders(config.toolOptions.extraHeaders), { 'X-Test': '1' });
});

test('invalid extra headers throw', () => {
  assert.throws(() => parseExtraHeaders('{bad json'), ToolOptionsError);
});

test('snapshot stores toolOptions', () => {
  const snap = snapshotWithToolOptions({ approach: 'IS', packId: 'INT' }, { vus: 3 });
  assert.deepEqual(snap.toolOptions, { vus: 3 });
});

test('vitest args honor bail and pool', () => {
  const args = vitestCliArgs(['npx', 'vitest', 'run'], { bail: true, pool: 'forks', reporter: 'verbose' });
  assert.deepEqual(args, ['npx', 'vitest', 'run', '--bail', '1', '--pool', 'forks', '--reporter', 'verbose']);
});

test('auditSeriousCount respects failOn threshold', () => {
  const stats = { critical: 0, high: 1, moderate: 2, low: 3 };
  assert.equal(auditSeriousCount(stats, 'high'), 1);
  assert.equal(auditSeriousCount(stats, 'moderate'), 3);
  assert.equal(auditSeriousCount(stats, 'low'), 6);
});

test('api local-pack re-exports shared defaultK6Path', () => {
  const apiPack = require('../../apps/api/src/approaches/local-pack.cjs');
  const sharedPack = require('../../shared/approaches/local-pack.cjs');
  assert.equal(typeof apiPack.defaultK6Path, 'function');
  assert.equal(apiPack.defaultK6Path, sharedPack.defaultK6Path);
});

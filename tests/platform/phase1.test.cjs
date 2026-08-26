const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runRetention, ARTIFACT_RETENTION_DAYS } = require('../../apps/api/src/retention/worker.cjs');

test('retention purges expired runtime sessions and marks old snapshots', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/DELETE FROM runtime_sessions/i.test(sql)) return { rowCount: 2 };
      if (/UPDATE cde_source_snapshots/i.test(sql)) return { rowCount: 1, rows: [{ id: 'snap-1' }] };
      if (/SELECT r\.id FROM runs/i.test(sql)) return { rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };
  const summary = await runRetention(pool);
  assert.equal(summary.runtimeSessions, 2);
  assert.equal(summary.snapshots, 1);
  assert.ok(queries.some(item => /runtime_sessions/i.test(item.sql)));
  assert.ok(ARTIFACT_RETENTION_DAYS >= 1);
});

test('runner uses shared createPool and does not import api server', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/runner/src/main.cjs'), 'utf8');
  assert.match(main, /shared\/db\/search-path\.cjs/);
  assert.match(main, /createPool/);
  assert.doesNotMatch(main, /api\/src\/server\.cjs/);
});

test('server wires domain pools and approach/run/report routes', () => {
  const root = path.resolve(__dirname, '..', '..');
  const server = fs.readFileSync(path.join(root, 'apps/api/src/server.cjs'), 'utf8');
  assert.match(server, /createPool/);
  assert.match(server, /shared\/db\/search-path\.cjs/);
  assert.match(server, /registerCdeRoutes/);
  assert.match(server, /registerApproachRoutes/);
  assert.match(server, /registerRuntimeRoutes/);
  assert.match(server, /registerRunRoutes/);
  assert.match(server, /registerReportRoutes/);
  assert.equal(fs.existsSync(path.join(root, 'apps/api/src/health/routes.cjs')), true);
});

test('shared contracts are used by api re-exports', () => {
  const constants = require('../../shared/approaches/constants.cjs');
  const paths = require('../../shared/is/paths.cjs');
  const searchPath = require('../../shared/db/search-path.cjs');
  const runStore = require('../../shared/db/run-store.cjs');
  assert.ok(constants.isTool('PLAYWRIGHT'));
  assert.equal(typeof paths.packPaths, 'function');
  assert.ok(searchPath.DOMAIN_SCHEMAS.includes('catalog'));
  assert.ok(searchPath.DOMAIN_SCHEMAS.includes('exec'));
  assert.match(searchPath.SEARCH_PATH_OPTIONS, /search_path=/);
  assert.equal(typeof searchPath.createPool, 'function');
  assert.equal(typeof runStore.insertRun, 'function');
  assert.match(runStore.RUN_CHILD_JOINS, /run_requests/);
});

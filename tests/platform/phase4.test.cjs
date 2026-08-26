const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { statusStateFromRun, splitFullName } = require('../../shared/git/status-checks.cjs');
const { evaluateQualityGate } = require('../../shared/quality-gate.cjs');

test('scm status mapping and fullName split', () => {
  assert.equal(statusStateFromRun('PASSED', true), 'success');
  assert.equal(statusStateFromRun('PASSED', false), 'failure');
  assert.equal(statusStateFromRun('FAILED', true), 'failure');
  assert.deepEqual(splitFullName('acme/app'), { owner: 'acme', repo: 'app' });
});

test('quality gate evaluates fail thresholds', async () => {
  const pool = {
    async query(sql) {
      if (/FROM quality_gates/i.test(sql)) {
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-1',
            name: 'default',
            require_status: 'PASSED',
            max_failed_tests: 0,
            max_fail_rate: 0.1,
            block_on_flaky: false,
            post_scm_status: true,
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const failed = await evaluateQualityGate(pool, {
    project_id: 'p1',
    status: 'FAILED',
    failed_tests: 2,
    total_tests: 10,
  });
  assert.equal(failed.passed, false);
  assert.ok(failed.reasons.length >= 1);

  const ok = await evaluateQualityGate(pool, {
    project_id: 'p1',
    status: 'PASSED',
    failed_tests: 0,
    total_tests: 10,
  });
  assert.equal(ok.passed, true);
});

test('phase 4 modules are wired', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/server.cjs'), 'utf8');
  const runner = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/runner/src/main.cjs'), 'utf8');
  const migration = fs.readFileSync(path.resolve(__dirname, '..', '..', 'database/010_phase4_ecosystem.sql'), 'utf8');
  const maturity = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/platform/routes.cjs'), 'utf8');
  assert.match(server, /registerGateRoutes/);
  assert.match(server, /registerOpsRoutes/);
  assert.match(runner, /runner_instances/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS quality_gates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS runner_instances/);
  assert.match(maturity, /phase: 4/);
});

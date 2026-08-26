const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { nextCronRun, isValidCron } = require('../../shared/cron-next.cjs');
const { eventsForStatus, signPayload } = require('../../shared/automation-dispatch.cjs');
const { normalizeScopes, createApiTokenValue } = require('../../apps/api/src/auth/api-token.cjs');
const { tickScheduler } = require('../../apps/api/src/automation/scheduler.cjs');

test('cron parser computes a future schedule', () => {
  assert.equal(isValidCron('0 * * * *'), true);
  assert.equal(isValidCron('not-a-cron'), false);
  const next = nextCronRun('0 * * * *', 'UTC');
  assert.ok(next instanceof Date);
  assert.ok(next.getTime() > Date.now());
});

test('run completion events map to webhook filters', () => {
  assert.deepEqual(eventsForStatus('PASSED'), ['run.completed', 'run.passed']);
  assert.deepEqual(eventsForStatus('FAILED'), ['run.completed', 'run.failed']);
  assert.deepEqual(eventsForStatus('ERROR'), ['run.completed', 'run.error']);
});

test('webhook signatures are deterministic', () => {
  const value = signPayload('secret', '{"ok":true}');
  assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(signPayload('secret', '{"ok":true}'), value);
});

test('api token scopes are normalized safely', () => {
  const scopes = normalizeScopes(['runs:create', 'invalid', 'runs:read']);
  assert.deepEqual(scopes, ['runs:create', 'runs:read']);
  assert.match(createApiTokenValue(), /^atk_/);
});

test('scheduler triggers due suites and advances next_run_at', async () => {
  const updates = [];
  const triggered = [];
  const pool = {
    async query(sql, params) {
      if (/FROM test_suites/i.test(sql)) {
        return {
          rowCount: 1,
          rows: [{
            id: 'suite-1',
            project_id: 'project-1',
            schedule_cron: '0 * * * *',
            schedule_timezone: 'UTC',
            items: [{ toolKind: 'DANGER' }],
            created_by: 'user-1',
          }],
        };
      }
      if (/UPDATE test_suites SET next_run_at/i.test(sql)) {
        updates.push(params);
        return { rowCount: 1 };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const summary = await tickScheduler(pool, {
    trigger: async (_pool, suite, options) => {
      triggered.push({ suiteId: suite.id, ...options });
      return [];
    },
  });
  assert.equal(summary.triggered, 1);
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].triggerSource, 'schedule');
  assert.equal(updates.length, 1);
  assert.ok(updates[0][1] instanceof Date);
});

test('server registers phase 2 automation routes and runner priority claim', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/server.cjs'), 'utf8');
  const runner = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/runner/src/main.cjs'), 'utf8');
  const migration = fs.readFileSync(path.resolve(__dirname, '..', '..', 'database/008_phase2_automation.sql'), 'utf8');
  assert.match(server, /registerAutomationRoutes/);
  assert.match(runner, /ORDER BY r\.priority DESC, r\.requested_at/);
  assert.match(runner, /dispatchRunCompleted/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS api_tokens/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS test_suites/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS webhooks/);
});

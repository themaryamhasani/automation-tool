const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { applySearchPath } = require('../../shared/db/search-path.cjs');
const {
  RUN_CHILD_JOINS, RUN_EVENT_COLUMNS, RUN_CLAIM_COLUMNS, insertRun, getRunLogs, completeRun,
} = require('../../shared/db/run-store.cjs');

test('012 migration and run-store exist', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database/012_run_split.sql'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'shared/db/run-store.cjs'), 'utf8');
  const events = fs.readFileSync(path.join(root, 'apps/api/src/runs/events.cjs'), 'utf8');
  const createRun = fs.readFileSync(path.join(root, 'apps/api/src/runs/create-run.cjs'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'apps/runner/src/main.cjs'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS exec\.run_requests/);
  assert.match(migration, /ALTER TABLE exec\.runs DROP COLUMN IF EXISTS source_snapshot/);
  assert.match(migration, /ALTER TABLE exec\.runs DROP COLUMN IF EXISTS logs/);
  assert.match(store, /function insertRun/);
  assert.match(store, /RUN_CHILD_JOINS/);
  assert.match(events, /shared\/db\/run-store\.cjs/);
  assert.match(createRun, /insertRun/);
  assert.match(runner, /completeRun/);
  assert.match(runner, /RUN_CLAIM_COLUMNS/);
  assert.match(RUN_EVENT_COLUMNS, /req\.browser_projects/);
  assert.match(RUN_CLAIM_COLUMNS, /src\.source_snapshot/);
  assert.match(RUN_CHILD_JOINS, /run_logs lg/);
});

test('fat run payloads live in child tables not runs columns', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await applySearchPath(client);
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='exec' AND table_name='runs'
          AND column_name = ANY($1::text[])`,
      [['source_snapshot', 'logs', 'report', 'browser_projects', 'cde_manifest', 'commit_sha', 'gate_summary']],
    );
    assert.equal(cols.rowCount, 0);
    const children = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='exec' AND table_name = ANY($1::text[])`,
      [['run_requests', 'run_sources', 'run_logs', 'run_results', 'run_scm']],
    );
    assert.equal(children.rowCount, 5);
  } finally {
    await client.end();
  }
});

test('insertRun writes children and completeRun updates results/logs', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const stamp = Date.now();
  let runId;
  let projectId;
  let userId;
  try {
    await applySearchPath(client);
    const user = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1,$2,'x','ADMIN') RETURNING id`,
      [`Run Split ${stamp}`, `run-split-${stamp}@automation.local`],
    );
    userId = user.rows[0].id;
    const project = await client.query(
      `INSERT INTO projects (name, code, source_approach) VALUES ($1,$2,'IS') RETURNING id`,
      [`run-split-${stamp}`, `rs-${stamp}`],
    );
    projectId = project.rows[0].id;
    const env = await client.query(
      `INSERT INTO environments (project_id, name, base_url) VALUES ($1,'qa','http://127.0.0.1') RETURNING id`,
      [projectId],
    );
    const created = await insertRun(client, {
      core: {
        project_id: projectId,
        environment_id: env.rows[0].id,
        test_file_path: 'scripts/api/run.mjs',
        requested_by: userId,
        status: 'QUEUED',
        source_approach: 'IS',
        tool_kind: 'DANGER',
        pack_id: 'INT',
      },
      request: { browser_projects: ['chromium'], workers: 2, timeout_seconds: 60 },
      source: { source_snapshot: '{"approach":"IS"}' },
      logs: 'queued',
    });
    runId = created.id;
    assert.ok(runId);
    assert.equal(await getRunLogs(client, runId), 'queued');
    const claim = await client.query(
      `SELECT ${RUN_CLAIM_COLUMNS}
         FROM runs r ${RUN_CHILD_JOINS}
         JOIN environments e ON e.id=r.environment_id
         JOIN projects p ON p.id=r.project_id
        WHERE r.id=$1`,
      [runId],
    );
    assert.equal(claim.rows[0].source_snapshot, '{"approach":"IS"}');
    assert.equal(claim.rows[0].workers, 2);
    await completeRun(client, runId, {
      status: 'PASSED',
      logs: 'done',
      report: { ok: true },
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      durationMs: 12,
      reportPaths: { board: 'x' },
    });
    const detail = await client.query(
      `SELECT ${RUN_EVENT_COLUMNS} FROM runs r ${RUN_CHILD_JOINS} WHERE r.id=$1`,
      [runId],
    );
    assert.equal(detail.rows[0].status, 'PASSED');
    assert.equal(detail.rows[0].total_tests, 1);
    assert.equal(detail.rows[0].report?.ok, true);
    assert.equal(await getRunLogs(client, runId), 'done');
  } finally {
    if (runId) await client.query('DELETE FROM runs WHERE id=$1', [runId]);
    if (projectId) {
      await client.query('DELETE FROM environments WHERE project_id=$1', [projectId]);
      await client.query('DELETE FROM projects WHERE id=$1', [projectId]);
    }
    if (userId) await client.query('DELETE FROM users WHERE id=$1', [userId]);
    await client.end();
  }
});

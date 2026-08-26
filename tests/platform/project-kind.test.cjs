const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { applySearchPath } = require('../../shared/db/search-path.cjs');
const {
  PROJECT_KIND_NAMED,
  PROJECT_KIND_WORKSPACE,
  isWorkspaceCode,
  namedProjectsSql,
  normalizeProjectKind,
} = require('../../shared/db/project-kind.cjs');
const { ensureWorkspaceProject } = require('../../apps/api/src/runs/create-run.cjs');

async function withClient(fn) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await applySearchPath(client);
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } finally {
    client.release();
    await pool.end();
  }
}

test('016 migration and project-kind helper exist', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database/016_project_kind.sql'), 'utf8');
  assert.match(migration, /kind varchar\(20\)/);
  assert.match(migration, /WORKSPACE/);
  assert.match(migration, /lower\(code\) LIKE 'ws-%'/);
  assert.equal(isWorkspaceCode('ws-cde'), true);
  assert.equal(isWorkspaceCode('tavan'), false);
  assert.equal(normalizeProjectKind(null, 'ws-is'), PROJECT_KIND_WORKSPACE);
  assert.equal(normalizeProjectKind(null, 'medu'), PROJECT_KIND_NAMED);
  assert.match(namedProjectsSql('p'), /p\.kind = 'NAMED'/);
  const server = fs.readFileSync(path.join(root, 'apps/api/src/server.cjs'), 'utf8');
  assert.match(server, /p\.kind = 'NAMED'/);
  assert.match(server, /WORKSPACE_CODE_RESERVED/);
  assert.match(server, /WORKSPACE_PROJECT_READONLY/);
  const createRun = fs.readFileSync(path.join(root, 'apps/api/src/runs/create-run.cjs'), 'utf8');
  assert.match(createRun, /PROJECT_KIND_WORKSPACE/);
  const filters = fs.readFileSync(path.join(root, 'apps/api/src/reports/filters.cjs'), 'utf8');
  assert.match(filters, /px\.kind = 'NAMED'/);
});

test('ensureWorkspaceProject marks kind=WORKSPACE and named list stays separate', async () => {
  await withClient(async (client) => {
    const user = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES ('WS Kind', $1, 'x', 'ADMIN', true) RETURNING id`,
      [`ws-kind-${Date.now()}@example.test`],
    );
    const named = await client.query(
      `INSERT INTO projects (code, name, source_approach, kind)
       VALUES ($1, 'Named App', 'CDE', $2) RETURNING id, kind, code`,
      [`named-${Date.now()}`, PROJECT_KIND_NAMED],
    );
    assert.equal(named.rows[0].kind, PROJECT_KIND_NAMED);

    const workspace = await ensureWorkspaceProject(client, { id: user.rows[0].id }, 'CDE');
    assert.equal(workspace.code, 'ws-cde');
    assert.equal(workspace.kind, PROJECT_KIND_WORKSPACE);
    const row = await client.query('SELECT kind FROM projects WHERE id = $1', [workspace.id]);
    assert.equal(row.rows[0].kind, PROJECT_KIND_WORKSPACE);

    const listed = await client.query(
      `SELECT code FROM projects WHERE ${namedProjectsSql('projects')} ORDER BY code`,
    );
    assert.ok(listed.rows.some((item) => item.code === named.rows[0].code));
    assert.ok(!listed.rows.some((item) => item.code === 'ws-cde'));
  });
});

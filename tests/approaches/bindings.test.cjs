const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { applySearchPath } = require('../../shared/db/search-path.cjs');
const {
  getBinding,
  upsertBinding,
  serializeBinding,
  CHILD_TABLES,
} = require('../../shared/db/bindings.cjs');

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

async function seedProject(client, code, approach = 'IS') {
  const project = await client.query(
    `INSERT INTO projects (code, name, source_approach) VALUES ($1, $2, $3) RETURNING id`,
    [code, code, approach],
  );
  const user = await client.query(
    `INSERT INTO users (full_name, email, password_hash, role, is_active)
     VALUES ('Binding Test', $1, 'x', 'ADMIN', true)
     RETURNING id`,
    [`binding-${code}@example.test`],
  );
  return { userId: user.rows[0].id, projectId: project.rows[0].id };
}

test('014 migration and binding helper exist', () => {
  const root = path.resolve(__dirname, '..', '..');
  assert.equal(fs.existsSync(path.join(root, 'database/014_binding_normalize.sql')), true);
  assert.equal(fs.existsSync(path.join(root, 'shared/db/bindings.cjs')), true);
  const migration = fs.readFileSync(path.join(root, 'database/014_binding_normalize.sql'), 'utf8');
  for (const table of CHILD_TABLES) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS source\\.${table}`));
  }
  const routes = fs.readFileSync(path.join(root, 'apps/api/src/approaches/routes.cjs'), 'utf8');
  assert.match(routes, /shared\/db\/bindings\.cjs/);
  assert.doesNotMatch(routes, /async function getBinding\(/);
  assert.doesNotMatch(routes, /async function upsertBinding\(/);
});

test('upsertBinding writes typed child and mirrors config', async () => {
  await withClient(async (client) => {
    const { projectId, userId } = await seedProject(client, `bind-is-${Date.now()}`, 'CDE');
    const isRow = await upsertBinding(client, projectId, 'IS', { packId: 'medu' });
    assert.equal(isRow.source_approach, 'IS');
    assert.equal(isRow.config.packId, 'MEDU');
    const isChild = await client.query('SELECT pack_id FROM binding_is WHERE project_id = $1', [projectId]);
    assert.equal(isChild.rows[0].pack_id, 'MEDU');
    assert.equal((await client.query('SELECT 1 FROM binding_cde WHERE project_id = $1', [projectId])).rowCount, 0);

    const gitRow = await upsertBinding(client, projectId, 'GITHUB', {
      remoteId: '42',
      fullName: 'acme/app',
      defaultBranch: 'develop',
      boundBy: userId,
      boundUsername: 'alice',
    });
    assert.equal(gitRow.config.fullName, 'acme/app');
    assert.equal(gitRow.config.remoteId, '42');
    assert.equal((await client.query('SELECT 1 FROM binding_is WHERE project_id = $1', [projectId])).rowCount, 0);
    const gitChild = await client.query('SELECT * FROM binding_git WHERE project_id = $1', [projectId]);
    assert.equal(gitChild.rows[0].full_name, 'acme/app');
    assert.equal(gitChild.rows[0].provider, 'GITHUB');

    const loaded = await getBinding(client, projectId);
    assert.equal(loaded.config.fullName, 'acme/app');
    assert.equal(serializeBinding(loaded).sourceApproach, 'GITHUB');
  });
});

test('zip and cde child tables round-trip through getBinding', async () => {
  await withClient(async (client) => {
    const { projectId } = await seedProject(client, `bind-zip-${Date.now()}`, 'ZIP');
    await upsertBinding(client, projectId, 'ZIP', {
      root: 'D:/tmp/zip-root',
      originalName: 'demo.zip',
      fileCount: 3,
      bytes: 99,
      extractedAt: '2026-01-02T03:04:05.000Z',
    });
    const zip = await getBinding(client, projectId);
    assert.equal(zip.config.root, 'D:/tmp/zip-root');
    assert.equal(zip.config.fileCount, 3);

    await upsertBinding(client, projectId, 'CDE', { packKey: 'tavan' });
    const cde = await getBinding(client, projectId);
    assert.equal(cde.config.packKey, 'tavan');
    assert.equal(cde.config.projectKey, 'tavan');
    assert.equal((await client.query('SELECT 1 FROM binding_zip WHERE project_id = $1', [projectId])).rowCount, 0);
  });
});

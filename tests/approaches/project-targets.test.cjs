const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { applySearchPath } = require('../../shared/db/search-path.cjs');
const { resolveAppTarget, warmTargetsFromDb, loadMergedTargets } = require('../../shared/runtime/app-targets.cjs');

test('project_targets table exists in catalog schema', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await applySearchPath(client);
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='catalog' AND table_name='project_targets'`,
    );
    assert.equal(tables.rowCount, 1);
    const rows = await client.query('SELECT pack_key FROM project_targets ORDER BY pack_key');
    assert.ok(rows.rowCount >= 3);
    assert.ok(rows.rows.some((row) => row.pack_key === 'tavan'));
    assert.ok(rows.rows.some((row) => row.pack_key === 'medu-camp'));
  } finally {
    await client.end();
  }
});

test('warmTargetsFromDb overlays resolveAppTarget', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await applySearchPath(client);
    const count = await warmTargetsFromDb(client);
    assert.ok(count >= 1);
    const target = resolveAppTarget('tavan');
    assert.equal(target.projectServiceId, 'tavan.medu.ir');
    assert.ok(Object.keys(loadMergedTargets()).includes('medu-community'));
  } finally {
    await client.end();
  }
});

test('013 migration and sync script are wired', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database/013_project_targets.sql'), 'utf8');
  const sync = fs.readFileSync(path.join(root, 'scripts/sync-project-targets.cjs'), 'utf8');
  const dbSetup = fs.readFileSync(path.join(root, 'scripts/db-setup.cjs'), 'utf8');
  const registry = fs.readFileSync(path.join(root, 'shared/runtime/targets-registry.json'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS catalog\.project_targets/);
  assert.match(sync, /syncProjectTargets/);
  assert.match(dbSetup, /syncProjectTargets/);
  assert.match(registry, /"tavan"/);
  assert.match(registry, /"medu-camp"/);
});

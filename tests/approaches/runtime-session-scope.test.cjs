const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { applySearchPath } = require('../../shared/db/search-path.cjs');
const {
  createLoginChallenge,
  deleteRuntimeSession,
  findConnectedRuntimeSession,
  getRuntimeSession,
  readLoginChallenge,
  setRuntimeSession,
} = require('../../shared/runtime/session-store.cjs');

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

async function seedEnv(client, suffix) {
  const user = await client.query(
    `INSERT INTO users (full_name, email, password_hash, role, is_active)
     VALUES ('Runtime Scope', $1, 'x', 'ADMIN', true) RETURNING id`,
    [`runtime-scope-${suffix}@example.test`],
  );
  const project = await client.query(
    `INSERT INTO projects (code, name, source_approach) VALUES ($1,$2,'CDE') RETURNING id`,
    [`ws-scope-${suffix}`, `ws-scope-${suffix}`],
  );
  const env = await client.query(
    `INSERT INTO environments (project_id, name, base_url, gateway_base_url, enabled)
     VALUES ($1, 'm-edus', 'https://soha.m.edus.ir', 'https://soha.m.edus.ir', true)
     RETURNING id, project_id`,
    [project.rows[0].id],
  );
  return { userId: user.rows[0].id, environmentId: env.rows[0].id, projectId: env.rows[0].project_id };
}

test('015 migration widens runtime_sessions primary key', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database/015_runtime_session_scope.sql'), 'utf8');
  assert.match(migration, /pack_key varchar\(255\)/);
  assert.match(migration, /PRIMARY KEY \(user_id, environment_id, pack_key\)/);
  assert.match(migration, /project_id uuid/);
  const store = fs.readFileSync(path.join(root, 'shared/runtime/session-store.cjs'), 'utf8');
  assert.match(store, /pack_key/);
  assert.match(store, /ON CONFLICT \(user_id, environment_id, pack_key\)/);
  const service = fs.readFileSync(path.join(root, 'apps/api/src/runtime/service.cjs'), 'utf8');
  assert.match(service, /sessionPackKey/);
  assert.match(service, /getRuntimeSession\(pool, req\.user\.id, target\.environment\.id, packKey\)/);
});

test('two packs can keep separate sessions on the same environment', async () => {
  await withClient(async (client) => {
    const { userId, environmentId } = await seedEnv(client, String(Date.now()));
    await setRuntimeSession(client, userId, environmentId, {
      phase: 'CONNECTED',
      projectKey: 'tavan',
      origin: 'https://tavan.medu.ir',
    }, 3600, 'tavan');
    await setRuntimeSession(client, userId, environmentId, {
      phase: 'CONNECTED',
      projectKey: 'medu-camp',
      origin: 'https://adib.m.edus.ir',
    }, 3600, 'medu-camp');

    const tavan = await getRuntimeSession(client, userId, environmentId, 'tavan');
    const camp = await getRuntimeSession(client, userId, environmentId, 'medu-camp');
    assert.equal(tavan.projectKey, 'tavan');
    assert.equal(camp.projectKey, 'medu-camp');
    assert.equal(tavan.origin, 'https://tavan.medu.ir');
    assert.equal(camp.origin, 'https://adib.m.edus.ir');

    const rows = await client.query(
      'SELECT pack_key FROM runtime_sessions WHERE user_id = $1 AND environment_id = $2 ORDER BY pack_key',
      [userId, environmentId],
    );
    assert.deepEqual(rows.rows.map((row) => row.pack_key), ['medu-camp', 'tavan']);

    await deleteRuntimeSession(client, userId, environmentId, 'tavan');
    assert.equal(await getRuntimeSession(client, userId, environmentId, 'tavan'), null);
    assert.equal((await getRuntimeSession(client, userId, environmentId, 'medu-camp')).projectKey, 'medu-camp');
  });
});

test('findConnectedRuntimeSession prefers matching pack_key', async () => {
  await withClient(async (client) => {
    const { userId, environmentId } = await seedEnv(client, `find-${Date.now()}`);
    await setRuntimeSession(client, userId, environmentId, {
      phase: 'CONNECTED',
      projectKey: 'alpha',
      origin: 'https://soha.m.edus.ir',
    }, 3600, 'alpha');
    await setRuntimeSession(client, userId, environmentId, {
      phase: 'CONNECTED',
      projectKey: 'beta',
      origin: 'https://adib.m.edus.ir',
    }, 3600, 'beta');

    const found = await findConnectedRuntimeSession(client, userId, {
      environmentId,
      projectKey: 'beta',
      packKey: 'beta',
    });
    assert.equal(found.projectKey, 'beta');
    assert.equal(found.origin, 'https://adib.m.edus.ir');
  });
});

test('login challenge is scoped to pack_key', () => {
  const challenge = createLoginChallenge('u1', 'e1', '9123456789', 'tavan');
  assert.equal(readLoginChallenge('u1', 'e1', challenge, 'tavan'), '9123456789');
  assert.throws(() => readLoginChallenge('u1', 'e1', challenge, 'medu-camp'));
});

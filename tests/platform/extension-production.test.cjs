const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const argon2 = require('argon2');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
process.env.SKIP_RUN_EVENT_BUS = '1';
const { createServer, pool } = require('../../apps/api/src/server.cjs');
const { tokenHash } = require('../../apps/api/src/middleware/auth.cjs');

function listen(app) {
  return new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
}

function request(server, method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: urlPath, method, headers: { 'content-type': 'application/json', ...(headers || {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login(server, email, password) {
  const response = await request(server, 'POST', '/api/auth/login', { body: { identity: email, password } });
  assert.equal(response.status, 200, response.text);
  return { authorization: `Bearer ${response.json.token}` };
}

test('production extension pairing, rotation, project scope, validation, upsert and revocation work end-to-end', async () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const email = `qa-recorder-${suffix}@automation.local`;
  const password = 'RecorderQa@12345';
  const user = await pool.query(
    `INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,'ADMIN') RETURNING id`,
    ['Recorder QA', email, await argon2.hash(password)],
  );
  const first = await pool.query(
    `INSERT INTO projects (name,code,source_approach,kind) VALUES ($1,$2,'IS','NAMED') RETURNING id`,
    ['Recorder Project One', `recorder-one-${suffix}`],
  );
  const second = await pool.query(
    `INSERT INTO projects (name,code,source_approach,kind) VALUES ($1,$2,'IS','NAMED') RETURNING id`,
    ['Recorder Project Two', `recorder-two-${suffix}`],
  );
  const environment = await pool.query(
    `INSERT INTO environments (project_id,name,base_url,enabled) VALUES ($1,'qa','https://example.test',true) RETURNING id`,
    [first.rows[0].id],
  );
  const server = await listen(createServer());
  let sessionId = null;
  let runId = null;
  try {
    const webHeaders = await login(server, email, password);
    const expiredPair = await request(server, 'POST', '/api/extension/pairings', { headers: webHeaders, body: {} });
    assert.equal(expiredPair.status, 201, expiredPair.text);
    assert.match(expiredPair.json.pairingCode, /^pair_/);
    const storedPair = await pool.query('SELECT code_hash FROM extension_pairing_codes WHERE code_hash=$1', [tokenHash(expiredPair.json.pairingCode)]);
    assert.equal(storedPair.rowCount, 1);
    assert.notEqual(storedPair.rows[0].code_hash, expiredPair.json.pairingCode);
    await pool.query('UPDATE extension_pairing_codes SET expires_at=now() - interval \'1 second\' WHERE code_hash=$1', [tokenHash(expiredPair.json.pairingCode)]);
    const expiredExchange = await request(server, 'POST', '/api/extension/pairings/exchange', { body: { pairingCode: expiredPair.json.pairingCode, deviceId: 'qa-device' } });
    assert.equal(expiredExchange.status, 401, expiredExchange.text);

    const pairing = await request(server, 'POST', '/api/extension/pairings', { headers: webHeaders, body: {} });
    const exchange = await request(server, 'POST', '/api/extension/pairings/exchange', { body: { pairingCode: pairing.json.pairingCode, deviceId: 'qa-device' } });
    assert.equal(exchange.status, 201, exchange.text);
    assert.match(exchange.json.accessToken, /^eat_/);
    assert.match(exchange.json.refreshToken, /^ert_/);
    sessionId = exchange.json.sessionId;
    const storedSession = await pool.query('SELECT access_token_hash,refresh_token_hash FROM extension_sessions WHERE id=$1', [sessionId]);
    assert.equal(storedSession.rows[0].access_token_hash, tokenHash(exchange.json.accessToken));
    assert.equal(storedSession.rows[0].refresh_token_hash, tokenHash(exchange.json.refreshToken));
    assert.notEqual(storedSession.rows[0].access_token_hash, exchange.json.accessToken);
    const reused = await request(server, 'POST', '/api/extension/pairings/exchange', { body: { pairingCode: pairing.json.pairingCode, deviceId: 'qa-device' } });
    assert.equal(reused.status, 401, reused.text);

    let accessToken = exchange.json.accessToken;
    let refreshToken = exchange.json.refreshToken;
    const auth = () => ({ authorization: `Bearer ${accessToken}` });

    await pool.query("UPDATE extension_sessions SET project_ids='{}'::uuid[] WHERE id=$1", [sessionId]);
    const emptyProjects = await request(server, 'GET', '/api/projects', { headers: auth() });
    assert.equal(emptyProjects.status, 200, emptyProjects.text);
    assert.deepEqual(emptyProjects.json, []);
    const emptyDenied = await request(server, 'GET', `/api/projects/${first.rows[0].id}/environments`, { headers: auth() });
    assert.equal(emptyDenied.status, 403, emptyDenied.text);

    await pool.query('UPDATE extension_sessions SET project_ids=$2 WHERE id=$1', [sessionId, [first.rows[0].id]]);
    const single = await request(server, 'GET', '/api/projects', { headers: auth() });
    assert.deepEqual(single.json.map(item => item.id), [first.rows[0].id]);
    const outOfScope = await request(server, 'GET', `/api/projects/${second.rows[0].id}/environments`, { headers: auth() });
    assert.equal(outOfScope.status, 403, outOfScope.text);

    await pool.query('UPDATE extension_sessions SET project_ids=$2 WHERE id=$1', [sessionId, [first.rows[0].id, second.rows[0].id]]);
    const multiple = await request(server, 'GET', '/api/projects', { headers: auth() });
    assert.deepEqual(new Set(multiple.json.map(item => item.id)), new Set([first.rows[0].id, second.rows[0].id]));

    const validSource = "import { test, expect } from '@playwright/test';\n\ntest('safe', async ({ page }) => {\n  await page.goto('https://example.test');\n  await expect(page).toHaveTitle(/Example/);\n});\n";
    const unsafeSource = "import { test } from '@playwright/test';\nconst password = 'never-persist-this';\ntest('unsafe', async ({ page }) => { await page.getByLabel('Password').fill(password); });";
    const blocked = await request(server, 'PUT', '/api/files/upsert', { headers: auth(), body: { projectId: first.rows[0].id, folderPath: 'recorded', fileName: 'unsafe.spec.ts', sourceCode: unsafeSource } });
    assert.equal(blocked.status, 422, blocked.text);
    assert.equal(blocked.json.code, 'SECRET_VALIDATION_FAILED');
    assert.ok(blocked.json.details.issues.some(issue => issue.category === 'sensitive_input'));
    assert.doesNotMatch(JSON.stringify(blocked.json), /never-persist-this/);

    const created = await request(server, 'PUT', '/api/files/upsert', { headers: auth(), body: { projectId: first.rows[0].id, folderPath: 'recorded', fileName: 'checkout.spec.ts', sourceCode: validSource } });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.revision, 1);
    const updated = await request(server, 'PUT', '/api/files/upsert', { headers: auth(), body: { projectId: first.rows[0].id, folderPath: 'recorded', fileName: 'checkout.spec.ts', sourceCode: validSource.replace("'safe'", "'safe updated'"), revision: 1 } });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json.id, created.json.id);
    assert.equal(updated.json.revision, 2);
    const conflict = await request(server, 'PUT', '/api/files/upsert', { headers: auth(), body: { projectId: first.rows[0].id, folderPath: 'recorded', fileName: 'checkout.spec.ts', sourceCode: validSource, revision: 1 } });
    assert.equal(conflict.status, 409, conflict.text);

    const run = await request(server, 'POST', '/api/runs', { headers: auth(), body: { projectId: first.rows[0].id, environmentId: environment.rows[0].id, testFileId: created.json.id, toolKind: 'PLAYWRIGHT', triggerSource: 'chrome-extension' } });
    assert.equal(run.status, 201, run.text);
    runId = run.json.id;

    await pool.query("UPDATE extension_sessions SET access_expires_at=now() - interval '1 second' WHERE id=$1", [sessionId]);
    const expiredAccess = await request(server, 'GET', '/api/projects', { headers: auth() });
    assert.equal(expiredAccess.status, 401, expiredAccess.text);
    assert.equal(expiredAccess.json.code, 'EXTENSION_AUTH_EXPIRED');
    const rotated = await request(server, 'POST', '/api/extension/auth/refresh', { body: { refreshToken, deviceId: 'qa-device' } });
    assert.equal(rotated.status, 200, rotated.text);
    accessToken = rotated.json.accessToken;
    const oldRefresh = await request(server, 'POST', '/api/extension/auth/refresh', { body: { refreshToken, deviceId: 'qa-device' } });
    assert.equal(oldRefresh.status, 401, oldRefresh.text);
    refreshToken = rotated.json.refreshToken;
    assert.ok(refreshToken);

    const revoked = await request(server, 'DELETE', `/api/extension/sessions/${sessionId}`, { headers: webHeaders });
    assert.equal(revoked.status, 200, revoked.text);
    const afterRevoke = await request(server, 'GET', '/api/projects', { headers: auth() });
    assert.equal(afterRevoke.status, 401, afterRevoke.text);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (runId) await pool.query('DELETE FROM runs WHERE id=$1', [runId]);
    await pool.query('DELETE FROM test_files WHERE project_id IN ($1,$2)', [first.rows[0].id, second.rows[0].id]);
    await pool.query('DELETE FROM environments WHERE project_id IN ($1,$2)', [first.rows[0].id, second.rows[0].id]);
    await pool.query('DELETE FROM extension_pairing_codes WHERE user_id=$1', [user.rows[0].id]);
    await pool.query('DELETE FROM extension_sessions WHERE user_id=$1', [user.rows[0].id]);
    await pool.query('DELETE FROM projects WHERE id IN ($1,$2)', [first.rows[0].id, second.rows[0].id]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [user.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id=$1', [user.rows[0].id]);
  }
});

test('pairing exchange is rate limited', async () => {
  const server = await listen(createServer());
  try {
    let response;
    for (let index = 0; index < 31; index += 1) {
      response = await request(server, 'POST', '/api/extension/pairings/exchange', { body: { pairingCode: `pair_invalid_${index}` } });
    }
    assert.equal(response.status, 429, response.text);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

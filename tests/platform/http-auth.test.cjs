const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const argon2 = require('argon2');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
process.env.SKIP_RUN_EVENT_BUS = '1';
const { createServer, pool } = require('../../apps/api/src/server.cjs');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: urlPath,
      method,
      headers: { 'content-type': 'application/json', ...(headers || {}) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('login issues a session cookie and /api/auth/me succeeds', async () => {
  const email = `qa-login-${Date.now()}@automation.local`;
  const password = 'QaLogin@12345';
  const hash = await argon2.hash(password);
  const inserted = await pool.query(
    `INSERT INTO users (full_name, email, phone_number, password_hash, role)
     VALUES ($1,$2,$3,$4,'ADMIN') RETURNING id`,
    ['QA Login', email, null, hash],
  );
  const app = createServer();
  const server = await listen(app);
  try {
    const login = await request(server, 'POST', '/api/auth/login', { body: { identity: email, password } });
    assert.equal(login.status, 200, login.text);
    assert.ok(login.json?.token);
    assert.match(String(login.headers['set-cookie'] || ''), /automation_session=/);
    const me = await request(server, 'GET', '/api/auth/me', {
      headers: { authorization: `Bearer ${login.json.token}` },
    });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json?.user?.email, email);
    const health = await request(server, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json?.status, 'ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [inserted.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id=$1', [inserted.rows[0].id]);
  }
});

test('scoped API tokens work end-to-end, reject unrelated routes, and honor revocation', async () => {
  const email = `qa-extension-token-${Date.now()}@automation.local`;
  const user = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1,$2,$3,'ADMIN') RETURNING id`,
    ['QA Extension Token', email, crypto.createHash('sha256').update('unused-password').digest('hex')],
  );
  const project = await pool.query("SELECT id FROM projects WHERE kind='NAMED' ORDER BY created_at LIMIT 1");
  assert.ok(project.rowCount, 'The integration database must contain a named project.');
  const rawToken = `atk_${crypto.randomBytes(24).toString('base64url')}`;
  const token = await pool.query(
    `INSERT INTO api_tokens (user_id,name,token_hash,token_prefix,scopes,project_ids,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,now() + interval '1 hour') RETURNING id`,
    [
      user.rows[0].id,
      'QA Chrome Recorder',
      crypto.createHash('sha256').update(rawToken).digest('hex'),
      rawToken.slice(0, 12),
      ['profile:read', 'projects:read'],
      [project.rows[0].id],
    ],
  );
  const server = await listen(createServer());
  try {
    const headers = { authorization: `Bearer ${rawToken}` };
    const me = await request(server, 'GET', '/api/auth/me', { headers });
    assert.equal(me.status, 200, me.text);
    assert.deepEqual(me.json.projectIds, [project.rows[0].id]);

    const projects = await request(server, 'GET', '/api/projects', { headers });
    assert.equal(projects.status, 200, projects.text);
    assert.deepEqual(projects.json.map(row => row.id), [project.rows[0].id]);

    const denied = await request(server, 'POST', '/api/projects', {
      headers,
      body: { name: 'Must not be created', code: `denied-${Date.now()}` },
    });
    assert.equal(denied.status, 403, denied.text);
    assert.equal(denied.json.code, 'TOKEN_SCOPE_DENIED');

    await pool.query('UPDATE api_tokens SET revoked_at=now() WHERE id=$1', [token.rows[0].id]);
    const revoked = await request(server, 'GET', '/api/auth/me', { headers });
    assert.equal(revoked.status, 401, revoked.text);
    assert.equal(revoked.json.code, 'INVALID_API_TOKEN');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.query('DELETE FROM api_tokens WHERE user_id=$1', [user.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id=$1', [user.rows[0].id]);
  }
});

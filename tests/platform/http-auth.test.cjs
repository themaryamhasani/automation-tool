const assert = require('node:assert/strict');
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

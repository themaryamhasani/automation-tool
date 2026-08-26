const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { generateTotpSecret, totp, verifyTotp, otpauthUrl } = require('../../shared/totp.cjs');
const { parseVaultRef, resolveSecretReferences } = require('../../shared/secrets-resolve.cjs');
const { backend, artifactObjectKey } = require('../../shared/object-storage.cjs');
const { environmentSecretReferences } = require('../../apps/api/src/lib/validators.cjs');
const { loadOpenApi, loadRunbook } = require('../../apps/api/src/platform/routes.cjs');
const { oidcEnabled } = require('../../apps/api/src/auth/oidc.cjs');

test('totp generate and verify round-trip', () => {
  const secret = generateTotpSecret();
  const code = totp(secret);
  assert.equal(verifyTotp(secret, code), true);
  assert.equal(verifyTotp(secret, '000000'), false);
  assert.match(otpauthUrl({ secret, accountName: 'admin@example.com' }), /^otpauth:\/\/totp\//);
});

test('vault refs parse and secret references accept vault sources', () => {
  const parsed = parseVaultRef('vault:app/db#password');
  assert.ok(parsed);
  assert.match(parsed.apiPath, /secret\/data\/app\/db/);
  assert.equal(parsed.field, 'password');
  const refs = environmentSecretReferences({ DB_PASS: 'vault:app/db#password', API_KEY: 'RUNNER_API_KEY' });
  assert.equal(refs.DB_PASS, 'vault:app/db#password');
});

test('object storage defaults to disk and builds artifact keys', () => {
  assert.equal(backend(), process.env.OBJECT_STORAGE_BACKEND === 's3' ? 's3' : 'disk');
  assert.match(artifactObjectKey('run-1', 'a/b.log'), /artifacts\/run-1\/a_b\.log/);
});

test('platform openapi and runbook are loadable', () => {
  const openapi = loadOpenApi();
  assert.equal(openapi.openapi, '3.0.3');
  assert.ok(openapi.paths['/api/analytics/runs/compare']);
  assert.ok(openapi.paths['/api/runs/{id}/delta']);
  const runbook = loadRunbook();
  assert.match(runbook, /Production runbook/);
  assert.equal(typeof oidcEnabled(), 'boolean');
});

test('phase 3 modules are wired in server and shared contracts', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/server.cjs'), 'utf8');
  const runner = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/runner/src/main.cjs'), 'utf8');
  const migration = fs.readFileSync(path.resolve(__dirname, '..', '..', 'database/009_phase3_maturity.sql'), 'utf8');
  assert.match(server, /registerAnalyticsRoutes/);
  assert.match(server, /registerPlatformDocRoutes/);
  assert.match(runner, /shared\/secrets-resolve/);
  assert.match(runner, /shared\/object-storage/);
  assert.match(runner, /refreshFlakyStats/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_challenges/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS flaky_test_stats/);
});

test('resolveSecretReferences reads process env', async () => {
  process.env.PHASE3_TEST_SECRET = 'value-1';
  const resolved = await resolveSecretReferences({ TARGET: 'PHASE3_TEST_SECRET' });
  assert.equal(resolved.TARGET, 'value-1');
  delete process.env.PHASE3_TEST_SECRET;
});

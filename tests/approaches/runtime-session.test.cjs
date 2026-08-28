const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  parseRuntimeOrigin,
  validateRuntimeOrigin,
  createRuntimeState,
  publicRuntimeStatus,
  hostAllowsIntranetResolution,
} = require('../../apps/api/src/runtime/runtime-core-client.cjs');
const { cookieHeaderFromState, importStorageStateIntoState, cookieHeadersForScopes } = require('../../shared/runtime/cookie-export.cjs');
const { CookieJar } = require('tough-cookie');

test('parseRuntimeOrigin accepts *.m.edus.ir hosts from allowlist', () => {
  const parsed = parseRuntimeOrigin('https://soha.m.edus.ir');
  assert.equal(parsed.origin, 'https://soha.m.edus.ir');
  assert.equal(parsed.host, 'soha.m.edus.ir');
});

test('parseRuntimeOrigin accepts *.medu.ir when profile allowlist is passed', () => {
  const parsed = parseRuntimeOrigin('https://tavan.medu.ir', { allowlist: ['*.medu.ir'] });
  assert.equal(parsed.origin, 'https://tavan.medu.ir');
});

test('parseRuntimeOrigin rejects non-allowlisted hosts', () => {
  assert.throws(
    () => parseRuntimeOrigin('https://example.com'),
    error => error.category === 'RUNTIME_ORIGIN_NOT_ALLOWED',
  );
});

test('*.medu.ir intranet hosts may resolve to RFC1918 (corp stage)', async () => {
  assert.equal(hostAllowsIntranetResolution('tavan.medu.ir'), true);
  const validated = await validateRuntimeOrigin('https://tavan.medu.ir', {
    allowlist: ['*.medu.ir'],
    lookup: async () => [{ address: '10.30.89.141', family: 4 }],
  });
  assert.equal(validated.origin, 'https://tavan.medu.ir');
  assert.deepEqual(validated.addresses, ['10.30.89.141']);
  assert.equal(validated.allowIntranet, true);
});

test('*.m.edus.ir still blocks private resolution by default', async () => {
  await assert.rejects(
    () => validateRuntimeOrigin('https://soha.m.edus.ir', {
      lookup: async () => [{ address: '10.30.89.141', family: 4 }],
    }),
    error => error.category === 'RUNTIME_SSRF_BLOCKED',
  );
});

test('intranet allowlist still blocks loopback resolution', async () => {
  await assert.rejects(
    () => validateRuntimeOrigin('https://tavan.medu.ir', {
      allowlist: ['*.medu.ir'],
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    error => error.category === 'RUNTIME_SSRF_BLOCKED',
  );
});

test('literal private IP origins remain blocked', async () => {
  await assert.rejects(
    () => validateRuntimeOrigin('https://10.30.89.141', {
      allowlist: ['10.30.89.141', '*.medu.ir'],
    }),
    error => error.category === 'RUNTIME_ORIGIN_NOT_ALLOWED' || error.category === 'RUNTIME_SSRF_BLOCKED',
  );
});

test('cookieHeaderFromState serializes tough-cookie jar for Playwright PREREG_COOKIE', async () => {
  const jar = new CookieJar();
  await jar.setCookie('session=abc123', 'https://soha.m.edus.ir/');
  const state = createRuntimeState('env-1');
  state.cookieJar = jar.serializeSync();
  state.phase = 'CONNECTED';
  const header = await cookieHeaderFromState(state, 'https://soha.m.edus.ir');
  assert.match(header, /session=abc123/);
});

test('multi-domain cookie import and scoped export', async () => {
  const state = createRuntimeState('env-1');
  await importStorageStateIntoState(state, {
    cookies: [
      { name: 'soha', value: 'hub', domain: 'soha.medu.ir', path: '/', secure: true },
      { name: 'tavan', value: 'app', domain: 'tavan.medu.ir', path: '/', secure: true },
    ],
  });
  const headers = await cookieHeadersForScopes(state, [
    'https://soha.medu.ir',
    'https://tavan.medu.ir',
  ]);
  assert.match(headers['https://soha.medu.ir'], /soha=hub/);
  assert.match(headers['https://tavan.medu.ir'], /tavan=app/);
});

test('Cookie header paste expands into _lsr and companion cookies', async () => {
  const { normalizeCookieEntries } = require('../../shared/runtime/cookie-export.cjs');
  const expanded = normalizeCookieEntries([{
    name: 'Cookie',
    value: '_gid=GA1.2.x; _lsr=s%3Asession.sig; _ga=GA1.2.y',
    domain: 'tavan.medu.ir',
    path: '/',
    secure: true,
    httpOnly: true,
  }]);
  assert.equal(expanded.length, 3);
  assert.equal(expanded.find(item => item.name === '_lsr')?.value, 's%3Asession.sig');
  assert.equal(expanded.find(item => item.name === '_lsr')?.httpOnly, true);

  const state = createRuntimeState('env-1');
  await importStorageStateIntoState(state, {
    cookies: [{
      name: 'Cookie',
      value: '_gid=GA1.2.x; _lsr=s%3Asession.sig; _ga=GA1.2.y',
      domain: 'tavan.medu.ir',
      path: '/',
      secure: true,
      httpOnly: true,
    }],
  });
  const header = await cookieHeaderFromState(state, 'https://tavan.medu.ir');
  assert.match(header, /_lsr=s%3Asession\.sig/);
  assert.doesNotMatch(header, /(?:^|;\s*)Cookie=/);
});

test('gitignore only ignores root /runtime/ packs, not api/shared runtime sources', () => {
  const root = path.resolve(__dirname, '../..');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/runtime\/\s*$/m);
  assert.doesNotMatch(gitignore, /^runtime\/\s*$/m);
  assert.equal(fs.existsSync(path.join(root, 'apps/api/src/runtime/runtime-core-client.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'shared/runtime/app-targets.cjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'apps/api/src/runtime/auth-handoff.cjs')), true);
});

test('tavan danger lib hydrates runtime session from PREREG_COOKIE', () => {
  const root = path.resolve(__dirname, '../..');
  const overlay = fs.readFileSync(path.join(root, 'scripts/pack-overlays/tavan/scripts/api/lib.mjs'), 'utf8');
  const packed = fs.readFileSync(path.join(root, 'runtime/packs/cde/tavan/scripts/api/lib.mjs'), 'utf8');
  for (const source of [overlay, packed]) {
    assert.match(source, /hydrateSessionFromEnvCookie/);
    assert.match(source, /liveRequestHeaders|client-id|prostage/);
    assert.match(source, /PREREG_COOKIE/);
    assert.doesNotMatch(source, /if \(env\('PREREG_COOKIE'\) \|\| env\('TAVAN_COOKIE'\)\) return \{ ok: true, source: 'env-cookie' \};/);
  }
});

test('publicRuntimeStatus reflects connected phase', () => {
  const state = createRuntimeState('env-1');
  state.phase = 'CONNECTED';
  assert.equal(publicRuntimeStatus(state).connected, true);
  assert.equal(publicRuntimeStatus(null).connected, false);
});

test('runner exports Cookie + Client-Id env from runtime session', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../apps/runner/src/runtime-session.cjs'),
    'utf8',
  );
  assert.match(source, /PREREG_COOKIE/);
  assert.match(source, /AUTOMATION_RUNTIME_CLIENT_ID/);
  assert.match(source, /AUTOMATION_RUNTIME_PROSTAGE/);
  assert.match(source, /AUTOMATION_RUNTIME_COOKIE_SCOPES/);
});

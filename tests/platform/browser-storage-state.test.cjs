const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeBrowserStorageState,
} = require('../../shared/runtime/browser-storage-state.cjs');
const {
  encryptBrowserStorageState,
  decryptBrowserStorageState,
} = require('../../shared/runtime/session-store.cjs');

test('normalizeBrowserStorageState keeps Playwright cookies and rejects empty jars', () => {
  const normalized = normalizeBrowserStorageState({
    cookies: [
      { name: 'sid', value: 'abc', domain: '.edus.ir', path: '/', httpOnly: true, secure: true },
      { name: '', value: 'x', domain: 'bad' },
    ],
    origins: [{ origin: 'https://adib.m.edus.ir', localStorage: [{ name: 'k', value: 'v' }] }],
  });
  assert.equal(normalized.cookies.length, 1);
  assert.equal(normalized.cookies[0].domain, 'edus.ir');
  assert.equal(normalized.origins.length, 1);
  assert.throws(
    () => normalizeBrowserStorageState({ cookies: [] }),
    error => error.code === 'BROWSER_STORAGE_STATE_EMPTY',
  );
});

test('browser storage state encrypts with a dedicated purpose and round-trips', () => {
  const state = normalizeBrowserStorageState({
    cookies: [{ name: '_lsr', value: 'token', domain: 'adib.m.edus.ir', path: '/', httpOnly: true }],
  });
  const packed = encryptBrowserStorageState(state);
  assert.equal(typeof packed, 'string');
  assert.doesNotMatch(packed, /token/);
  assert.deepEqual(decryptBrowserStorageState(packed), state);
});

test('normalizeBrowserStorageState fills missing cookie domain from sibling cookies', () => {
  const normalized = normalizeBrowserStorageState({
    cookies: [
      { name: 'sid', value: 'abc', domain: 'adib.m.edus.ir', path: '/', httpOnly: true },
      { name: 'extra', value: '1', path: '/' },
    ],
  });
  assert.equal(normalized.cookies.length, 2);
  assert.equal(normalized.cookies[1].domain, 'adib.m.edus.ir');
});

test('create-run stores cookie name/domain metadata for Save & Run diagnostics', () => {
  const createRun = fs.readFileSync(path.join(__dirname, '..', '..', 'apps/api/src/runs/create-run.cjs'), 'utf8');
  assert.match(createRun, /browserStorageCookieDomains/);
  assert.match(createRun, /browserStorageCookieNames/);
});

test('runner loads dotenv before decrypting browser storage and fails closed on bad ciphertext', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'apps/runner/src/main.cjs'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '..', '..', 'shared/runtime/session-store.cjs'), 'utf8');
  assert.match(runner, /require\('dotenv'\)\.config/);
  assert.ok(runner.indexOf("require('dotenv')") < runner.indexOf('decryptBrowserStorageState'));
  assert.match(store, /function encryptionKey\(/);
  assert.match(runner, /رمزگشایی نشست مرورگر ناموفق بود/);
});

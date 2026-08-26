const assert = require('node:assert/strict');
const test = require('node:test');
const { compileDataServicePackage } = require('../../apps/api/src/cde/data-service-compiler.cjs');
const { createCdeState, getDataSource } = require('../../apps/api/src/cde/core-client.cjs');
const { decryptText, encryptText } = require('../../shared/snapshot-crypto.cjs');

test('CDE snapshot source is encrypted and authenticated at rest', () => {
  const source = "export const secret = 'source-only';";
  const encrypted = encryptText(source);
  assert.notEqual(encrypted, source);
  assert.ok(!encrypted.includes('source-only'));
  assert.equal(decryptText(encrypted), source);
  const tamperAt = Math.floor(encrypted.length / 2);
  const tampered = `${encrypted.slice(0, tamperAt)}${encrypted[tamperAt] === 'A' ? 'B' : 'A'}${encrypted.slice(tamperAt + 1)}`;
  assert.throws(() => decryptText(tampered));
});

test('Data Service TypeScript is compiled into executable CommonJS', () => {
  const build = compileDataServicePackage([{ name: 'src/index.ts', code: 'export const answer: number = 42;' }]);
  assert.equal(build[0].name, 'src/index.js');
  assert.match(build[0].build, /exports\.answer/);
  assert.doesNotMatch(build[0].build, /: number/);
});

test('CDE core client rejects providers outside the explicit allowlist', async () => {
  await assert.rejects(
    () => getDataSource(createCdeState(), 'untrusted/provider', {}),
    error => error.code === 'CDE_PROVIDER_NOT_ALLOWED' && error.status === 403,
  );
});

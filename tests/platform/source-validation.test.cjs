const assert = require('node:assert/strict');
const test = require('node:test');
const { sourceValidation } = require('../../apps/api/src/files/source-validation.cjs');

test('AST source validation catches direct and indirect secrets without returning their values', () => {
  const cases = [
    "await page.getByLabel('Password').fill('plain-secret')",
    "const password = 'indirect-secret'; await page.getByLabel('Password').fill(password)",
    "await page.setExtraHTTPHeaders({ Authorization: 'Bearer abcdefghijklmnop' })",
    "await page.setExtraHTTPHeaders({ Cookie: 'sid=private' })",
    "document.cookie = 'sid=private'",
    "await context.storageState({ path: 'authenticated.json' })",
    "test.use({ storageState: { cookies: [{ name: 'sid', value: 'private' }] } })",
    "const apiKey = 'private-key'; await page.goto('https://example.test')",
    "await page.request.post('/login', { data: { password: 'private' } })",
    "const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue'",
  ];
  for (const source of cases) {
    const result = sourceValidation(source);
    assert.equal(result.valid, false, source);
    assert.ok(result.issues.length, source);
    assert.doesNotMatch(JSON.stringify(result), /plain-secret|indirect-secret|private-key|abcdefghijklmnop|sid=private|signaturevalue/);
  }
});

test('AST source validation accepts environment-backed Playwright source', () => {
  const result = sourceValidation(`import { test } from '@playwright/test';
    test('login', async ({ page }) => {
      await page.getByLabel('Password').fill(process.env.TEST_PASSWORD ?? '');
      await page.goto('https://example.test');
    });`);
  assert.deepEqual(result, { valid: true, issues: [] });
});

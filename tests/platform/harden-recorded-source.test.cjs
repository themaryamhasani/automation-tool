const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { hardenRecordedSource } = require('../../shared/playwright/harden-recorded-source.cjs');

test('hardenRecordedSource scopes options to listbox and matches fill filter loosely', () => {
  const source = `import { test, expect } from '@playwright/test';

test('Recorded test', async ({ page }) => {
  await page.getByRole('combobox', { name: 'نوع مدرسه' }).click();
  await page.getByRole('option', { name: 'دولتی', exact: true }).click();
  await page.getByRole('combobox', { name: 'چهارچوب قانون اردو انتخابی (انواع اردو)' }).click();
  await page.getByRole('combobox', { name: 'چهارچوب قانون اردو انتخابی (انواع اردو)' }).fill('ابتدایی');
  await page.getByRole('option', { name: 'ابتدایی (درون شهرستانی-چند روزه پایه ششم تا 7 نفر)' }).click();
});
`;
  const hardened = hardenRecordedSource(source);
  assert.match(hardened, /getByRole\('listbox'\)\.getByRole\('option', \{ name: 'دولتی'/);
  assert.match(hardened, /getByRole\('listbox'\)\.getByRole\('option', \{ name: \/ابتدایی\/ \}\)/);
  assert.doesNotMatch(hardened, /name: 'ابتدایی \(درون/);
});

test('runner-side harden injects option helper that lists visible options on failure', () => {
  const source = `import { test, expect } from '@playwright/test';

test('Recorded test', async ({ page }) => {
  await page.getByRole('combobox', { name: 'نوع مدرسه' }).click();
  await page.getByRole('option', { name: 'دولتی', exact: true }).click();
});
`;
  const hardened = hardenRecordedSource(source, { withOptionHelper: true });
  assert.match(hardened, /async function __automationClickOption/);
  assert.match(hardened, /await __automationClickOption\(page,/);
  assert.match(hardened, /گزینه .* پیدا نشد/);
  assert.match(hardened, /گزینه‌های موجود/);
  assert.match(hardened, /\.fill\("دولتی"\)/);
  assert.match(hardened, /aria-expanded="true"/);
  const again = hardenRecordedSource(hardened, { withOptionHelper: true });
  assert.equal((again.match(/async function __automationClickOption/g) || []).length, 1);
});

test('runner-side harden filters long camp framework options before click', () => {
  const source = `import { test, expect } from '@playwright/test';

test('Recorded test', async ({ page }) => {
  await page.getByRole('combobox', { name: 'چهارچوب قانون اردو انتخابی (انواع اردو)' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'ابتدایی (درون شهرستانی-چند روزه پایه ششم تا 7 نفر)' }).click();
});
`;
  const hardened = hardenRecordedSource(source, { withOptionHelper: true });
  assert.match(hardened, /\.fill\("ابتدایی"\)/);
  assert.match(hardened, /__automationClickOption\(page,/);
  assert.match(hardened, /ArrowDown/);
});

test('runner-side harden wraps goto and fails fast on auth redirects', () => {
  const source = `import { test, expect } from '@playwright/test';

test('Recorded test', async ({ page }) => {
  await page.goto('https://adib.m.edus.ir/camp/school/registered-camps');
  await page.getByRole('button', { name: 'ثبت اردو جدید' }).click();
});
`;
  const hardened = hardenRecordedSource(source, { withOptionHelper: true });
  assert.match(hardened, /async function __automationGoto/);
  assert.match(hardened, /await __automationGoto\(page, 'https:\/\/adib\.m\.edus\.ir\/camp\/school\/registered-camps'\);/);
  assert.match(hardened, /نشست ورود روی سرور ناقص بود/);
  assert.match(hardened, /soha/);
});

test('persisted Playwright config writes failure screenshots under the run workspace', () => {
  const processSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'apps/runner/src/process.cjs'), 'utf8');
  assert.match(processSrc, /outputDir:\s*path\.join\(absWorkspace,\s*'test-results'\)/);
  assert.match(processSrc, /\$\{outputDir \? `outputDir:/);
});

test('runner materializes hardened recorded sources with option helper for persisted Playwright runs', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'apps/runner/src/main.cjs'), 'utf8');
  assert.match(runner, /hardenRecordedSource\(/);
  assert.match(runner, /withOptionHelper:\s*true/);
  assert.match(runner, /registerFailureEvidence/);
  assert.match(runner, /shared\/playwright\/harden-recorded-source\.cjs/);
});

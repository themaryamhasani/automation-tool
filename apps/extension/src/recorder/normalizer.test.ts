import { describe, expect, it } from 'vitest';
import { normalizeRecorderSource, prepareRecording, sanitizeFileName, sanitizeTestName } from './normalizer';

describe('recording normalizer', () => {
  it('keeps Playwright Test source deterministic and updates its title', () => {
    const result = normalizeRecorderSource(`import { test, expect } from '@playwright/test';\r\n\r\ntest('old', async ({ page }) => {\r\n  await page.goto('https://example.com');\r\n});`, 'Checkout smoke');
    expect(result).toContain("test('Checkout smoke', async ({ page }) => {");
    expect(result).toContain("await page.goto('https://example.com');");
    expect(result.endsWith('\n')).toBe(true);
  });

  it('wraps plain Playwright actions as a TypeScript test', () => {
    const result = normalizeRecorderSource("await page.goto('https://example.com');\nawait page.getByRole('link').click();", 'Links');
    expect(result).toMatch(/^import \{ test, expect \} from '@playwright\/test';/);
    expect(result).toContain("test('Links'");
  });

  it('sanitizes destination names', () => {
    expect(sanitizeFileName('../../My Checkout TEST.spec.ts')).toBe('my-checkout-test.spec.ts');
    expect(sanitizeFileName('%%%')).toBe('recorded-test.spec.ts');
    expect(sanitizeTestName('  Login\n  flow ')).toBe('Login flow');
  });

  it('prepares runner-compatible source in one pipeline', () => {
    const prepared = prepareRecording("await page.goto('https://example.com');", 'Example', 'Example');
    expect(prepared.fileName).toBe('example.spec.ts');
    expect(prepared.source).toContain("from '@playwright/test'");
  });
});

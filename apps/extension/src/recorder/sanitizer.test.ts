import { describe, expect, it } from 'vitest';
import { sanitizeSource } from './sanitizer';

describe('secret sanitizer', () => {
  it('replaces password values based on semantic locator context', () => {
    const result = sanitizeSource("  await page.getByLabel('Password').fill('SuperSecret123!');");
    expect(result.source).toBe("  await page.getByLabel('Password').fill(process.env.TEST_PASSWORD ?? '');");
    expect(result.environmentVariables).toEqual(['TEST_PASSWORD']);
    expect(result.changed).toBe(true);
    expect(result.source).not.toContain('SuperSecret123!');
  });

  it('replaces token-like literals even without a sensitive field name', () => {
    const result = sanitizeSource("await page.locator('#value').fill('sk-abcdefghijklmnopqrstuvwxyz123456');");
    expect(result.source).toContain("process.env.TEST_SECRET ?? ''");
    expect(result.source).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('removes cookie and storage state operations', () => {
    const result = sanitizeSource("await context.addCookies([{ name: 'sid', value: 'secret' }]);\nawait page.goto('https://example.com');");
    expect(result.source).toContain('Sensitive browser state removed');
    expect(result.source).not.toContain("value: 'secret'");
    expect(result.warnings[0]).toMatch(/never be uploaded/i);
  });

  it('removes complete multi-line cookie calls and blanks cookie headers', () => {
    const result = sanitizeSource([
      'await context.addCookies([',
      "  { name: 'sid', value: 'multi-line-secret', domain: 'example.com', path: '/' },",
      ']);',
      "await page.setExtraHTTPHeaders({ 'Cookie': 'sid=header-secret' });",
      "await page.goto('https://example.com');",
    ].join('\n'));
    expect(result.source).not.toContain('multi-line-secret');
    expect(result.source).not.toContain('header-secret');
    expect(result.source).not.toContain("name: 'sid'");
    expect(result.source).toContain("'Cookie': ''");
    expect(result.source).toContain("page.goto('https://example.com')");
  });

  it('redacts authorization headers', () => {
    const result = sanitizeSource("await page.setExtraHTTPHeaders({ Authorization: 'Bearer abcdefghijklmnop' });");
    expect(result.source).toContain("Authorization: process.env.TEST_TOKEN ?? ''");
  });

  it('protects a secret passed through a local variable', () => {
    const result = sanitizeSource("const password = 'do-not-store-me';\nawait page.getByLabel('Password').fill(password);");
    expect(result.source).not.toContain('do-not-store-me');
    expect(result.source).toContain("const password = process.env.TEST_PASSWORD ?? ''");
    expect(result.environmentVariables).toContain('TEST_PASSWORD');
  });
});

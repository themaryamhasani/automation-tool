import { ExtensionError } from '../shared/errors';
import { sanitizeSource } from './sanitizer';
import type { PreparedRecording } from './types';

function quoteTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' ').trim().slice(0, 160) || 'Recorded test';
}

export function sanitizeTestName(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Recorded test';
}

export function sanitizeFileName(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/\.(?:spec|test)\.(?:ts|js)$/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '') || 'recorded-test';
  return `${base}.spec.ts`;
}

export function normalizeRecorderSource(raw: string, testName: string): string {
  let source = raw.replace(/\r\n?/g, '\n').trim();
  if (!source) throw new ExtensionError('INVALID_SOURCE');
  source = source.replace(/^\s*\/\/\s*@ts-check\s*\n/i, '');

  const hasTestImport = /from\s+['"]@playwright\/test['"]/.test(source);
  const hasTestBody = /\btest(?:\.\w+)?\s*\(/.test(source);
  if (!hasTestImport || !hasTestBody) {
    const actionLines = source
      .split('\n')
      .filter(line => !/^\s*(?:const\s*\{\s*chromium|const\s+browser|const\s+context|await\s+browser\.close)/.test(line))
      .map(line => line.trim())
      .filter(line => /^(?:await\s+)?(?:page\.|expect\()/.test(line));
    if (!actionLines.length) throw new ExtensionError('INVALID_SOURCE');
    source = `import { test, expect } from '@playwright/test';\n\ntest('${quoteTitle(testName)}', async ({ page }) => {\n${actionLines.map(line => `  ${line}`).join('\n')}\n});`;
  } else {
    source = source.replace(
      /(\btest(?:\.\w+)?\s*\(\s*)(['"])(?:\\.|(?!\2).)*\2/,
      `$1'${quoteTitle(testName)}'`,
    );
  }

  if (!/\b(?:page\.|expect\()/.test(source)) throw new ExtensionError('INVALID_SOURCE');
  return `${source.trim()}\n`;
}

export function validatePreparedSource(source: string): void {
  if (new TextEncoder().encode(source).byteLength > 2 * 1024 * 1024) throw new ExtensionError('INVALID_SOURCE', 'The generated test exceeds the 2 MB file limit.');
  if (!/from\s+['"]@playwright\/test['"]/.test(source) || !/\btest(?:\.\w+)?\s*\(/.test(source)) {
    throw new ExtensionError('INVALID_SOURCE');
  }
  if (/\b(?:chromium|firefox|webkit)\.launch\s*\(|from\s+['"]playwright-crx|chrome\.debugger|chrome\.runtime/.test(source)) {
    throw new ExtensionError('INVALID_SOURCE', 'Extension-only or browser-launch code cannot be saved as a Runner test.');
  }
}

export function prepareRecording(raw: string, testName: string, fileName: string): PreparedRecording {
  const normalized = normalizeRecorderSource(raw, sanitizeTestName(testName));
  const sanitized = sanitizeSource(normalized);
  validatePreparedSource(sanitized.source);
  return {
    ...sanitized,
    testName: sanitizeTestName(testName),
    fileName: sanitizeFileName(fileName),
  };
}

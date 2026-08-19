'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  extractErrorPath,
  solutionHint,
  enrichSummary,
  writeFindingsReport,
} = require('../apps/runner/src/report-findings.cjs');
const { writeLocalTaxonomy } = require('../apps/runner/src/local-reports.cjs');
const { parseSummary } = require('../apps/runner/src/is-reports.cjs');

test('extractErrorPath reads stack and relative spec paths', () => {
  const fromStack = extractErrorPath({
    error: 'Error: boom\n    at Object.<anonymous> (D:\\AllApp\\IS\\x\\specs\\g10.spec.ts:46:42)',
  });
  assert.match(fromStack, /g10\.spec\.ts:46/);
  const fromTitle = extractErrorPath({ title: 'chromium › specs/qa-checklist-auth-brand.spec.ts:18:3 › auth' });
  assert.match(fromTitle, /qa-checklist-auth-brand\.spec\.ts/);
});

test('solutionHint covers dual playwright and empty dashboard races', () => {
  const dual = solutionHint({
    toolKind: 'PLAYWRIGHT',
    outcome: 'unexpected',
    error: 'Error: Requiring @playwright/test second time',
  });
  assert.match(dual, /دو نصب Playwright/);
  const empty = solutionHint({
    toolKind: 'PLAYWRIGHT',
    outcome: 'unexpected',
    error: 'صفحه نباید خالی باشد',
    path: 'specs/qa-checklist-auth-brand.spec.ts:22',
  });
  assert.match(empty, /auth setup|waitAppIdle|loading/i);
});

test('parseSummary enriches FAIL details with path and hint', () => {
  const out = `
  x   3 [chromium] › specs\\g10-eligibility-gate.spec.ts:74:3 › G10 eligibility gate UI › gated (5.7s)
Error: expect(received).toBeTruthy()
    at assertContinueGated (D:\\AllApp\\IS\\integrated-systems\\test\\doc\\assessment\\pre-registration\\scripts\\e2e\\specs\\g10-eligibility-gate.spec.ts:46:42)
  1 failed
`;
  const stats = parseSummary(out, null, 'PLAYWRIGHT');
  assert.ok(stats.details.length >= 1);
  const fail = stats.details.find(item => item.outcome === 'unexpected');
  assert.ok(fail);
  assert.ok(fail.path);
  assert.ok(fail.hint);
  assert.match(fail.hint, /.+/);
});

test('every approach taxonomy writes 02-findings with Hint and path', () => {
  const previous = process.env.SOURCE_REPORT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'findings-rep-'));
  process.env.SOURCE_REPORT_ROOT = root;
  try {
    const out = '--- REQ ---\n  ✗ FAIL  TC-X-002 — broken at specs/demo.spec.ts:12\nError: Timeout waiting for locator\n';
    const saved = writeLocalTaxonomy({
      source_approach: 'CDE',
      project_id: 'p1',
      project_name: 'demo',
      tool_kind: 'PLAYWRIGHT',
      flow_id: 'REQ',
    }, { code: 1, out, title: 'demo' });
    const findings = path.join(saved.product, '02-findings.md');
    assert.equal(saved.findings, findings);
    assert.ok(fs.existsSync(findings));
    const text = fs.readFileSync(findings, 'utf8');
    assert.match(text, /Hint|راه‌حل/);
    assert.match(text, /مسیر ایجاد خطا/);
    assert.match(text, /اپروچ/);
    const board = fs.readFileSync(saved.board, 'utf8');
    assert.match(board, /02-findings\.md/);
    assert.match(board, /FAILها — مسیر و راهنمای رفع/);
    const flow = fs.readFileSync(path.join(saved.product, 'by-flow', 'REQ.md'), 'utf8');
    assert.match(flow, /یافته‌های FAIL و راهنمای رفع/);
  } finally {
    if (previous == null) delete process.env.SOURCE_REPORT_ROOT;
    else process.env.SOURCE_REPORT_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeFindingsReport is approach-agnostic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'findings-only-'));
  try {
    const stats = enrichSummary({
      pass: 0,
      fail: 1,
      skip: 0,
      total: 1,
      summary: '1 failed',
      details: [{
        title: 'specs/foo.spec.ts › bar',
        projectName: 'e2e',
        outcome: 'unexpected',
        duration: 1,
        error: 'Error: Named export \'x\' not found. The requested module is a CommonJS module',
      }],
    }, { toolKind: 'PLAYWRIGHT' });
    const saved = writeFindingsReport(root, {
      approach: 'GITHUB',
      toolKind: 'PLAYWRIGHT',
      command: 'playwright test',
      when: '2026-08-16 16:00',
      stats,
    });
    const md = fs.readFileSync(saved.file, 'utf8');
    assert.match(md, /GITHUB/);
    assert.match(md, /type":"module"|type:\s*"module"|package\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  classifyChange, buildRunDelta, detailsFromReport, isFail,
} = require('../../shared/run-delta.cjs');

test('classifyChange marks regression still-fail and fixed', () => {
  assert.equal(classifyChange('expected', 'unexpected'), 'new_fail');
  assert.equal(classifyChange('unexpected', 'unexpected'), 'still_fail');
  assert.equal(classifyChange('unexpected', 'expected'), 'fixed');
  assert.equal(classifyChange(null, 'unexpected'), 'new_fail');
  assert.equal(classifyChange('skipped', 'unexpected'), 'new_fail');
  assert.equal(classifyChange('unexpected', 'skipped'), 'fail_to_skip');
});

test('buildRunDelta summarizes new still and fixed', () => {
  const left = [
    { title: 'A', outcome: 'expected' },
    { title: 'B', outcome: 'unexpected', error: 'boom', path: 'a.spec.ts' },
    { title: 'C', outcome: 'unexpected' },
  ];
  const right = [
    { title: 'A', outcome: 'unexpected', error: 'regressed' },
    { title: 'B', outcome: 'expected' },
    { title: 'C', outcome: 'unexpected' },
  ];
  const delta = buildRunDelta(left, right);
  assert.equal(delta.summary.newFail, 1);
  assert.equal(delta.summary.fixed, 1);
  assert.equal(delta.summary.stillFail, 1);
  assert.equal(delta.summary.regressionCount, 1);
  assert.equal(delta.summary.openFailCount, 2);
  assert.ok(delta.items.some(item => item.change === 'new_fail' && item.title === 'A'));
  assert.ok(delta.items.some(item => item.change === 'fixed' && item.title === 'B'));
  assert.ok(delta.items.some(item => item.change === 'still_fail' && item.title === 'C'));
  assert.equal(isFail('timedOut'), true);
});

test('detailsFromReport tolerates missing report', () => {
  assert.deepEqual(detailsFromReport(null), []);
  assert.deepEqual(detailsFromReport({ details: [{ title: 'x', outcome: 'expected' }] }).length, 1);
});

test('runs routes expose delta endpoint and previous_run without SELECT r.*', () => {
  const routes = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/api/src/runs/routes.cjs'), 'utf8');
  assert.match(routes, /\/api\/runs\/:id\/delta/);
  assert.match(routes, /PREVIOUS_RUN_JSON/);
  assert.match(routes, /buildRunDelta/);
  assert.doesNotMatch(routes, /SELECT r\.\*/);
});

test('RunReportPanel and RunsPage surface delta UX', () => {
  const panel = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/components/RunReportPanel.tsx'), 'utf8');
  const page = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps/web/src/pages/RunsPage.tsx'), 'utf8');
  assert.match(panel, /\/api\/runs\/.*\/delta/);
  assert.match(panel, /رگرسیون/);
  assert.match(panel, /هنوز باز/);
  assert.match(panel, /رفع‌شده/);
  assert.match(page, /Δ نسبت به قبلی/);
  assert.match(page, /previousRun/);
  assert.match(page, /بدتر از قبلی/);
});

test('openapi documents runs delta', () => {
  const openapi = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs/openapi.json'), 'utf8'));
  assert.ok(openapi.paths['/api/runs/{id}/delta']);
});

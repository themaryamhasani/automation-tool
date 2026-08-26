'use strict';

/** Classify per-test changes between two run report detail arrays. */

function isFail(outcome) {
  return ['unexpected', 'failed', 'timedOut', 'interrupted'].includes(String(outcome || ''));
}

function isPass(outcome) {
  return ['expected', 'passed'].includes(String(outcome || ''));
}

function isSkip(outcome) {
  return String(outcome || '') === 'skipped';
}

function testKey(item) {
  if (!item) return '';
  return String(item.title || item.path || item.file || '').trim();
}

function classifyChange(leftOutcome, rightOutcome) {
  const left = leftOutcome || null;
  const right = rightOutcome || null;
  if (left === right) {
    if (isFail(left)) return 'still_fail';
    if (isPass(left)) return 'unchanged_pass';
    if (isSkip(left)) return 'unchanged_skip';
    return 'unchanged';
  }
  if (isFail(right) && (!left || isPass(left) || isSkip(left))) return 'new_fail';
  if (isFail(left) && isFail(right)) return 'still_fail';
  if (isFail(left) && isPass(right)) return 'fixed';
  if (isFail(left) && isSkip(right)) return 'fail_to_skip';
  if (isPass(left) && isSkip(right)) return 'pass_to_skip';
  if (isSkip(left) && isPass(right)) return 'skip_to_pass';
  if (!left && isPass(right)) return 'new_pass';
  if (isFail(left) && !right) return 'removed_fail';
  if (isPass(left) && !right) return 'removed_pass';
  return 'changed';
}

function buildRunDelta(leftTests = [], rightTests = []) {
  const leftMap = new Map();
  const rightMap = new Map();
  for (const item of leftTests) {
    const key = testKey(item);
    if (key) leftMap.set(key, item);
  }
  for (const item of rightTests) {
    const key = testKey(item);
    if (key) rightMap.set(key, item);
  }
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const items = [];
  const summary = {
    newFail: 0,
    stillFail: 0,
    fixed: 0,
    failToSkip: 0,
    passToSkip: 0,
    skipToPass: 0,
    newPass: 0,
    removedFail: 0,
    changed: 0,
    unchangedFail: 0,
  };

  for (const key of keys) {
    const a = leftMap.get(key);
    const b = rightMap.get(key);
    const leftOutcome = a?.outcome || null;
    const rightOutcome = b?.outcome || null;
    const change = classifyChange(leftOutcome, rightOutcome);
    if (change === 'unchanged_pass' || change === 'unchanged_skip' || change === 'unchanged') continue;

    if (change === 'new_fail') summary.newFail += 1;
    else if (change === 'still_fail') {
      summary.stillFail += 1;
      summary.unchangedFail += 1;
    } else if (change === 'fixed') summary.fixed += 1;
    else if (change === 'fail_to_skip') summary.failToSkip += 1;
    else if (change === 'pass_to_skip') summary.passToSkip += 1;
    else if (change === 'skip_to_pass') summary.skipToPass += 1;
    else if (change === 'new_pass') summary.newPass += 1;
    else if (change === 'removed_fail') summary.removedFail += 1;
    else summary.changed += 1;

    items.push({
      title: key,
      change,
      leftOutcome,
      rightOutcome,
      leftError: a?.error || null,
      rightError: b?.error || null,
      path: b?.path || a?.path || null,
      hint: b?.hint || a?.hint || null,
    });
  }

  const order = {
    new_fail: 0, still_fail: 1, fail_to_skip: 2, fixed: 3, pass_to_skip: 4,
    skip_to_pass: 5, removed_fail: 6, new_pass: 7, changed: 8,
  };
  items.sort((x, y) => (order[x.change] ?? 99) - (order[y.change] ?? 99) || x.title.localeCompare(y.title));

  return {
    summary: {
      ...summary,
      changedTests: items.length,
      regressionCount: summary.newFail,
      openFailCount: summary.newFail + summary.stillFail,
    },
    items: items.slice(0, 300),
  };
}

function detailsFromReport(report) {
  if (!report || typeof report !== 'object') return [];
  return Array.isArray(report.details) ? report.details : [];
}

module.exports = {
  isFail,
  isPass,
  isSkip,
  testKey,
  classifyChange,
  buildRunDelta,
  detailsFromReport,
};

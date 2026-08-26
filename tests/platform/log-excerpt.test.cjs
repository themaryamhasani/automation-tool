const assert = require('node:assert/strict');
const test = require('node:test');
const { excerptLogs, LOG_EXCERPT_CHARS } = require('../../shared/log-excerpt.cjs');

test('excerptLogs keeps short text unchanged', () => {
  assert.equal(excerptLogs('ok'), 'ok');
});

test('excerptLogs trims oversized runner output to the tail', () => {
  const huge = `${'x'.repeat(LOG_EXCERPT_CHARS + 80)}TAIL`;
  const excerpt = excerptLogs(huge);
  assert.ok(excerpt.startsWith('[log truncated'));
  assert.ok(excerpt.endsWith('TAIL'));
  assert.ok(excerpt.length < huge.length);
  assert.ok(excerpt.length <= LOG_EXCERPT_CHARS + 80);
});

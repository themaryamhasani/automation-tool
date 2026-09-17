const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assessBrowserSession,
  sessionAssessmentError,
} = require('../../shared/runtime/browser-session-assess.cjs');

test('assessBrowserSession rejects analytics-only jars on adib', () => {
  const result = assessBrowserSession({
    cookies: [
      { name: '_ga', value: '1', domain: 'edus.ir' },
      { name: '_gid', value: '1', domain: 'edus.ir' },
      { name: '_gat', value: '1', domain: 'edus.ir' },
    ],
  }, 'https://adib.m.edus.ir/camp/school/registered-camps');
  assert.equal(result.ok, false);
  assert.ok(['thin-session', 'no-host-cookies', 'missing-sso'].includes(result.reason));
});

test('assessBrowserSession accepts adib httpOnly session on /camp without readable soha cookies', () => {
  const result = assessBrowserSession({
    cookies: [
      { name: '_ga', value: '1', domain: 'edus.ir' },
      { name: '_cdesc', value: 'x', domain: 'adib.m.edus.ir', httpOnly: true },
      { name: 'other', value: '1', domain: 'git.edus.ir' },
    ],
  }, 'https://adib.m.edus.ir/camp/school/registered-camps');
  assert.equal(result.ok, true);
  assert.equal(result.ssoCookies, 0);
  assert.ok(result.httpOnlyForHost >= 1);
});

test('assessBrowserSession rejects adib httpOnly session when tab is not on /camp', () => {
  const result = assessBrowserSession({
    cookies: [
      { name: '_cdesc', value: 'x', domain: 'adib.m.edus.ir', httpOnly: true },
    ],
  }, 'https://adib.m.edus.ir/');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-on-app-page');
});

test('assessBrowserSession accepts adib + soha session cookies', () => {
  const result = assessBrowserSession({
    cookies: [
      { name: '_lsr', value: 'token', domain: 'soha.m.edus.ir', httpOnly: true },
      { name: '_cdesc', value: 'x', domain: 'adib.m.edus.ir', httpOnly: true },
      { name: 'sid', value: '1', domain: 'adib.m.edus.ir' },
    ],
  }, 'https://adib.m.edus.ir/camp/school/registered-camps');
  assert.equal(result.ok, true);
  assert.ok(result.ssoCookies >= 1);
  assert.match(sessionAssessmentError({ ok: false, reason: 'missing-sso', domains: ['edus.ir'], total: 1 }), /adib|soha/i);
});

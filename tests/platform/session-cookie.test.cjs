const assert = require('node:assert/strict');
const test = require('node:test');
const { sessionCookie, clearSessionCookie, tokenFromRequest } = require('../../shared/session-cookie.cjs');

test('session cookie is HttpOnly and can be read back from the request', () => {
  const header = sessionCookie('abc+token', 3600);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.equal(tokenFromRequest({ get: name => (name === 'cookie' ? header : '') }), 'abc+token');
});

test('Bearer token still wins when both cookie and Authorization are present', () => {
  const token = tokenFromRequest({
    get: name => {
      if (name === 'authorization') return 'Bearer from-header';
      if (name === 'cookie') return sessionCookie('from-cookie', 60);
      return '';
    },
  });
  assert.equal(token, 'from-header');
});

test('clearing the session cookie expires it immediately', () => {
  assert.match(clearSessionCookie(), /Max-Age=0/);
});

test('production cookies are Secure unless COOKIE_SECURE=0', () => {
  const previousEnv = process.env.NODE_ENV;
  const previousCookie = process.env.COOKIE_SECURE;
  process.env.NODE_ENV = 'production';
  delete process.env.COOKIE_SECURE;
  assert.match(sessionCookie('token', 60), /Secure/);
  process.env.COOKIE_SECURE = '0';
  assert.doesNotMatch(sessionCookie('token', 60), /Secure/);
  process.env.NODE_ENV = previousEnv;
  if (previousCookie == null) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = previousCookie;
});

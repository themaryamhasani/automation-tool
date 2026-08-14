const COOKIE = 'automation_session';

function cookieSecure() {
  if (process.env.COOKIE_SECURE === '0') return false;
  if (process.env.COOKIE_SECURE === '1') return true;
  return process.env.NODE_ENV === 'production';
}

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(60, Number(maxAgeSeconds) || 86400)}`,
  ];
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  const parts = [`${COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

function tokenFromRequest(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.get('cookie') || '';
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  return match ? decodeURIComponent(match[1]) : '';
}

module.exports = { COOKIE, sessionCookie, clearSessionCookie, tokenFromRequest, cookieSecure };

const crypto = require('node:crypto');

const API_TOKEN_PREFIX = 'atk_';
const DEFAULT_SCOPES = ['runs:create', 'runs:read'];
const ALLOWED_SCOPES = new Set([
  'runs:create', 'runs:read', 'runs:cancel',
  'suites:read', 'suites:write', 'suites:run',
  'webhooks:read', 'webhooks:write',
  'notifications:read', 'notifications:write',
]);

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function apiTokenFromRequest(req) {
  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const header = req.get('x-api-token');
  return header ? String(header).trim() : null;
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : DEFAULT_SCOPES;
  const filtered = [...new Set(values.map(item => String(item).trim()).filter(item => ALLOWED_SCOPES.has(item)))];
  return filtered.length ? filtered : DEFAULT_SCOPES;
}

function createApiTokenValue() {
  return `${API_TOKEN_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
}

function hasScope(req, scope) {
  if (!req.apiToken) return true;
  return Array.isArray(req.apiToken.scopes) && req.apiToken.scopes.includes(scope);
}

function requireScope(...scopes) {
  return (req, _res, next) => {
    if (!req.apiToken) return next();
    if (scopes.some(scope => hasScope(req, scope))) return next();
    const { ApiError } = require('../http.cjs');
    return next(new ApiError(403, 'TOKEN_SCOPE_DENIED', 'این توکن API اجازه انجام این عملیات را ندارد.'));
  };
}

module.exports = {
  API_TOKEN_PREFIX,
  ALLOWED_SCOPES,
  apiTokenFromRequest,
  normalizeScopes,
  createApiTokenValue,
  hasScope,
  requireScope,
  tokenHash,
};

const crypto = require('node:crypto');

const API_TOKEN_PREFIX = 'atk_';
const EXTENSION_ACCESS_TOKEN_PREFIX = 'eat_';
const EXTENSION_REFRESH_TOKEN_PREFIX = 'ert_';
const EXTENSION_SCOPES = ['profile:read', 'projects:read', 'files:read', 'files:write', 'runs:create', 'runs:read'];
const DEFAULT_SCOPES = ['runs:create', 'runs:read'];
const ALLOWED_SCOPES = new Set([
  'profile:read', 'projects:read',
  'files:read', 'files:write',
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

function requireSession(req, _res, next) {
  if (!req.apiToken) return next();
  const { ApiError } = require('../http.cjs');
  return next(new ApiError(403, 'SESSION_AUTH_REQUIRED', 'مدیریت توکن فقط از نشست امن وب امکان‌پذیر است.'));
}

const API_TOKEN_ROUTES = [
  { method: 'GET', path: /^\/auth\/me$/, scopes: ['profile:read'] },
  { method: 'GET', path: /^\/projects$/, scopes: ['projects:read'] },
  { method: 'GET', path: /^\/projects\/[^/]+\/environments$/, scopes: ['projects:read'] },
  { method: 'GET', path: /^\/files(?:\/folders|\/[^/]+)?$/, scopes: ['files:read'] },
  { method: 'POST', path: /^\/files\/validate$/, scopes: ['files:write'] },
  { method: 'PUT', path: /^\/files\/upsert$/, scopes: ['files:write'] },
  { method: 'DELETE', path: /^\/extension\/auth\/session$/, scopes: ['profile:read'] },
  { method: 'POST', path: /^\/files$/, scopes: ['files:write'] },
  { method: 'PUT', path: /^\/files\/[^/]+$/, scopes: ['files:write'] },
  { method: 'DELETE', path: /^\/files\/[^/]+$/, scopes: ['files:write'] },
  { method: 'GET', path: /^\/runs(?:\/[^/]+(?:\/(?:events|logs|delta))?)?$/, scopes: ['runs:read'] },
  { method: 'POST', path: /^\/runs$/, scopes: ['runs:create'] },
  { method: 'POST', path: /^\/runs\/[^/]+\/cancel$/, scopes: ['runs:cancel'] },
  { method: 'GET', path: /^\/artifacts\/[^/]+\/download$/, scopes: ['runs:read'] },
  { method: 'GET', path: /^\/projects\/[^/]+\/suites$/, scopes: ['suites:read'] },
  { method: 'POST', path: /^\/projects\/[^/]+\/suites$/, scopes: ['suites:write'] },
  { method: 'PUT', path: /^\/projects\/[^/]+\/suites\/[^/]+$/, scopes: ['suites:write'] },
  { method: 'DELETE', path: /^\/projects\/[^/]+\/suites\/[^/]+$/, scopes: ['suites:write'] },
  { method: 'POST', path: /^\/projects\/[^/]+\/suites\/[^/]+\/run$/, scopes: ['suites:run', 'runs:create'] },
  { method: 'GET', path: /^\/projects\/[^/]+\/webhooks$/, scopes: ['webhooks:read'] },
  { method: 'POST', path: /^\/projects\/[^/]+\/webhooks$/, scopes: ['webhooks:write'] },
  { method: 'PUT', path: /^\/projects\/[^/]+\/webhooks\/[^/]+$/, scopes: ['webhooks:write'] },
  { method: 'DELETE', path: /^\/projects\/[^/]+\/webhooks\/[^/]+$/, scopes: ['webhooks:write'] },
  { method: 'GET', path: /^\/projects\/[^/]+\/notifications$/, scopes: ['notifications:read'] },
  { method: 'POST', path: /^\/projects\/[^/]+\/notifications$/, scopes: ['notifications:write'] },
  { method: 'PUT', path: /^\/projects\/[^/]+\/notifications\/[^/]+$/, scopes: ['notifications:write'] },
  { method: 'DELETE', path: /^\/projects\/[^/]+\/notifications\/[^/]+$/, scopes: ['notifications:write'] },
];

function apiPath(req) {
  const path = String(req.originalUrl || req.url || req.path || '').split('?')[0];
  return path.replace(/^\/api(?=\/|$)/, '') || '/';
}

function authorizeApiTokenRequest(req, _res, next) {
  if (!req.apiToken) return next();
  const path = apiPath(req);
  if (/^\/tokens(?:\/|$)/.test(path) || /^\/auth\/(?:logout|change-password)$/.test(path)) return next();
  const rule = API_TOKEN_ROUTES.find(candidate => candidate.method === req.method && candidate.path.test(path));
  if (rule && rule.scopes.some(scope => hasScope(req, scope))) return next();
  const { ApiError } = require('../http.cjs');
  return next(new ApiError(403, 'TOKEN_SCOPE_DENIED', 'این توکن API اجازه دسترسی به این مسیر را ندارد.'));
}

module.exports = {
  API_TOKEN_PREFIX,
  EXTENSION_ACCESS_TOKEN_PREFIX,
  EXTENSION_REFRESH_TOKEN_PREFIX,
  EXTENSION_SCOPES,
  ALLOWED_SCOPES,
  apiTokenFromRequest,
  normalizeScopes,
  createApiTokenValue,
  hasScope,
  requireScope,
  requireSession,
  authorizeApiTokenRequest,
  tokenHash,
};

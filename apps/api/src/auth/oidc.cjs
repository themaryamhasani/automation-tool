function oidcEnabled() {
  return process.env.OIDC_ENABLED === '1'
    && Boolean(process.env.OIDC_ISSUER)
    && Boolean(process.env.OIDC_CLIENT_ID)
    && Boolean(process.env.OIDC_CLIENT_SECRET)
    && Boolean(process.env.OIDC_REDIRECT_URI);
}

function oidcConfig() {
  return {
    issuer: String(process.env.OIDC_ISSUER || '').replace(/\/$/, ''),
    clientId: process.env.OIDC_CLIENT_ID || '',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    redirectUri: process.env.OIDC_REDIRECT_URI || '',
    scopes: process.env.OIDC_SCOPES || 'openid profile email',
  };
}

async function discoverOidc() {
  const { issuer } = oidcConfig();
  const url = `${issuer}/.well-known/openid-configuration`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`OIDC discovery failed (${response.status}).`);
  return response.json();
}

function buildAuthorizeUrl(discovery, { state, nonce }) {
  const cfg = oidcConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: cfg.scopes,
    redirect_uri: cfg.redirectUri,
    state,
    nonce,
  });
  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

async function exchangeCode(discovery, code) {
  const cfg = oidcConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OIDC token exchange failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchUserInfo(discovery, accessToken) {
  if (!discovery.userinfo_endpoint) return null;
  const response = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return null;
  return response.json();
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  oidcEnabled,
  oidcConfig,
  discoverOidc,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  decodeJwtPayload,
};

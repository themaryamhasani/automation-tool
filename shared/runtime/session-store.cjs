const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { resolveEncryptionKey } = require('../crypto-key.cjs');

const SESSION_TTL_SECONDS = Number(process.env.RUNTIME_SESSION_TTL_SECONDS || 2 * 60 * 60);

function encryptionMaterial() {
  const configured = String(process.env.RUNTIME_SESSION_ENCRYPTION_KEY || '').trim();
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RUNTIME_SESSION_ENCRYPTION_KEY must contain at least 32 characters in production.');
  }
  return resolveEncryptionKey();
}

const encryptionKey = createHash('sha256').update(encryptionMaterial()).digest();

function normalizePackKey(value) {
  return String(value || '').trim();
}

function encrypt(value, purpose = 'runtime-session') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(`automation-tool-runtime:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function decrypt(value, purpose = 'runtime-session') {
  const packed = Buffer.from(String(value), 'base64url');
  if (packed.length < 29) throw new Error('RUNTIME_ENCRYPTED_VALUE_INVALID');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAAD(Buffer.from(`automation-tool-runtime:${purpose}`));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

async function resolveProjectId(pool, environmentId) {
  if (!environmentId) return null;
  const result = await pool.query('SELECT project_id FROM environments WHERE id = $1', [environmentId]);
  return result.rows[0]?.project_id || null;
}

async function getRuntimeSession(pool, userId, environmentId, packKey = '') {
  const key = normalizePackKey(packKey);
  const result = await pool.query(
    `SELECT encrypted_state FROM runtime_sessions
      WHERE user_id = $1 AND environment_id = $2 AND pack_key = $3 AND expires_at > now()`,
    [userId, environmentId, key],
  );
  if (!result.rowCount) return null;
  try { return decrypt(result.rows[0].encrypted_state); }
  catch { await deleteRuntimeSession(pool, userId, environmentId, key); return null; }
}

async function setRuntimeSession(pool, userId, environmentId, state, ttlSeconds = SESSION_TTL_SECONDS, packKey = '') {
  const key = normalizePackKey(packKey || state?.projectKey || '');
  const projectId = state?.projectId || await resolveProjectId(pool, environmentId);
  const payload = { ...state, projectKey: state?.projectKey || key || null, projectId: projectId || null };
  await pool.query(
    `INSERT INTO runtime_sessions (user_id, environment_id, pack_key, project_id, encrypted_state, expires_at)
     VALUES ($1, $2, $3, $4, $5, now()+($6||' seconds')::interval)
     ON CONFLICT (user_id, environment_id, pack_key) DO UPDATE SET
       project_id = COALESCE(excluded.project_id, runtime_sessions.project_id),
       encrypted_state = excluded.encrypted_state,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [userId, environmentId, key, projectId, encrypt(payload), ttlSeconds],
  );
  return payload;
}

async function deleteRuntimeSession(pool, userId, environmentId, packKey = '') {
  await pool.query(
    'DELETE FROM runtime_sessions WHERE user_id = $1 AND environment_id = $2 AND pack_key = $3',
    [userId, environmentId, normalizePackKey(packKey)],
  );
}

async function deleteAllRuntimeSessionsForUser(pool, userId) {
  await pool.query('DELETE FROM runtime_sessions WHERE user_id = $1', [userId]);
}

function createLoginChallenge(userId, environmentId, userLoginName, packKey = '') {
  return encrypt({
    userId: String(userId),
    environmentId: String(environmentId),
    packKey: normalizePackKey(packKey),
    userLoginName: String(userLoginName),
    expiresAt: Date.now() + 5 * 60 * 1000,
  }, 'runtime-login-challenge');
}

function readLoginChallenge(userId, environmentId, challenge, packKey = '') {
  const value = decrypt(challenge, 'runtime-login-challenge');
  const expectedPack = normalizePackKey(packKey);
  const challengePack = normalizePackKey(value.packKey);
  if (
    value.userId !== String(userId)
    || value.environmentId !== String(environmentId)
    || challengePack !== expectedPack
    || Number(value.expiresAt) <= Date.now()
  ) {
    throw new Error('RUNTIME_LOGIN_CHALLENGE_EXPIRED');
  }
  return String(value.userLoginName || '');
}

async function findConnectedRuntimeSession(pool, userId, { projectKey, environmentId, packKey } = {}) {
  const wanted = normalizePackKey(packKey || projectKey);
  if (environmentId) {
    const direct = await getRuntimeSession(pool, userId, environmentId, wanted);
    if (direct?.phase === 'CONNECTED') return direct;
    // Legacy rows may still live under pack_key='' for the same env.
    if (wanted) {
      const legacy = await getRuntimeSession(pool, userId, environmentId, '');
      if (legacy?.phase === 'CONNECTED' && (!legacy.projectKey || legacy.projectKey === wanted)) {
        return legacy;
      }
    }
  }
  const result = await pool.query(
    `SELECT rs.environment_id, rs.pack_key, rs.encrypted_state, e.name, e.base_url, e.gateway_base_url
       FROM runtime_sessions rs
       JOIN environments e ON e.id = rs.environment_id
      WHERE rs.user_id = $1 AND rs.expires_at > now()
      ORDER BY
        CASE WHEN $2::text <> '' AND rs.pack_key = $2 THEN 0 ELSE 1 END,
        CASE WHEN e.name = 'm-edus' THEN 0 ELSE 1 END,
        rs.updated_at DESC
      LIMIT 40`,
    [userId, wanted],
  );
  for (const row of result.rows) {
    try {
      const state = decrypt(row.encrypted_state);
      if (state?.phase !== 'CONNECTED') continue;
      if (wanted) {
        const stateKey = normalizePackKey(state.projectKey || row.pack_key);
        if (stateKey && stateKey !== wanted) continue;
        if (!stateKey && row.pack_key && row.pack_key !== wanted) continue;
      }
      if (!state.origin) {
        const fromEnv = String(row.gateway_base_url || row.base_url || '').replace(/\/$/, '');
        if (fromEnv) state.origin = fromEnv;
      }
      return state;
    } catch {
      await deleteRuntimeSession(pool, userId, row.environment_id, row.pack_key);
    }
  }
  return null;
}

module.exports = {
  SESSION_TTL_SECONDS,
  createLoginChallenge,
  deleteAllRuntimeSessionsForUser,
  deleteRuntimeSession,
  findConnectedRuntimeSession,
  getRuntimeSession,
  normalizePackKey,
  readLoginChallenge,
  setRuntimeSession,
};

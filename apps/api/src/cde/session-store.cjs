const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { resolveEncryptionKey } = require('../../../../shared/crypto-key.cjs');

const SESSION_TTL_SECONDS = Number(process.env.CDE_SESSION_TTL_SECONDS || 12 * 60 * 60);
const encryptionKey = createHash('sha256').update(resolveEncryptionKey()).digest();

function encrypt(value, purpose = 'session') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(`automation-tool-cde:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function decrypt(value, purpose = 'session') {
  const packed = Buffer.from(String(value), 'base64url');
  if (packed.length < 29) throw new Error('CDE_ENCRYPTED_VALUE_INVALID');
  const iv = packed.subarray(0, 12); const tag = packed.subarray(12, 28); const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAAD(Buffer.from(`automation-tool-cde:${purpose}`)); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}
async function getCdeSession(pool, sessionId) {
  const result = await pool.query('SELECT encrypted_state FROM cde_sessions WHERE session_id=$1 AND expires_at>now()', [sessionId]);
  if (!result.rowCount) return null;
  try { return decrypt(result.rows[0].encrypted_state); }
  catch { await deleteCdeSession(pool, sessionId); return null; }
}
async function setCdeSession(pool, sessionId, state, ttlSeconds = SESSION_TTL_SECONDS) {
  await pool.query(
    `INSERT INTO cde_sessions (session_id,encrypted_state,expires_at) VALUES ($1,$2,now()+($3||' seconds')::interval)
     ON CONFLICT (session_id) DO UPDATE SET encrypted_state=excluded.encrypted_state,expires_at=excluded.expires_at,updated_at=now()`,
    [sessionId, encrypt(state), ttlSeconds],
  );
  return state;
}
async function deleteCdeSession(pool, sessionId) { await pool.query('DELETE FROM cde_sessions WHERE session_id=$1', [sessionId]); }
function createLoginChallenge(sessionId, userLoginName) { return encrypt({ sessionId, userLoginName: String(userLoginName), expiresAt: Date.now() + 5 * 60 * 1000 }, 'login-challenge'); }
function readLoginChallenge(sessionId, challenge) {
  const value = decrypt(challenge, 'login-challenge');
  if (value.sessionId !== sessionId || Number(value.expiresAt) <= Date.now()) throw new Error('CDE_LOGIN_CHALLENGE_EXPIRED');
  return String(value.userLoginName || '');
}
module.exports = { createLoginChallenge, deleteCdeSession, getCdeSession, readLoginChallenge, setCdeSession };

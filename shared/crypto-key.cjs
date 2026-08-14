const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDERS = new Set([
  '',
  'automation-tool-development-cde-key-change-me',
  'automation-tool-development-cde-session-key',
]);

function keyFile() {
  return path.resolve(__dirname, '..', 'runtime', '.encryption-key');
}

function resolveEncryptionKey() {
  const env = String(process.env.CDE_SESSION_ENCRYPTION_KEY || '').trim();
  if (env.length >= 32 && !PLACEHOLDERS.has(env)) return env;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CDE_SESSION_ENCRYPTION_KEY must be a 32+ character secret in production.');
  }
  const file = keyFile();
  try {
    if (fs.existsSync(file)) {
      const stored = fs.readFileSync(file, 'utf8').trim();
      if (stored.length >= 32) return stored;
    }
  } catch { /* generate below */ }
  const generated = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generated, { encoding: 'utf8', mode: 0o600 });
  console.warn(JSON.stringify({ event: 'encryption-key-generated', file }));
  return generated;
}

module.exports = { resolveEncryptionKey };

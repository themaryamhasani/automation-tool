const crypto = require('node:crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const cleaned = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % (10 ** digits)).padStart(digits, '0');
}

function totp(secret, { step = 30, digits = 6, now = Date.now() } = {}) {
  const counter = Math.floor(now / 1000 / step);
  return hotp(secret, counter, digits);
}

function verifyTotp(secret, token, { window = 1, step = 30, digits = 6, now = Date.now() } = {}) {
  const expected = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(expected)) return false;
  const counter = Math.floor(now / 1000 / step);
  for (let i = -window; i <= window; i += 1) {
    if (hotp(secret, counter + i, digits) === expected) return true;
  }
  return false;
}

function otpauthUrl({ secret, accountName, issuer = 'Automation Tool' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

module.exports = {
  generateTotpSecret,
  totp,
  verifyTotp,
  otpauthUrl,
  base32Encode,
  base32Decode,
};

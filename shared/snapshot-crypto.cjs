const crypto = require('node:crypto');
const { resolveEncryptionKey } = require('./crypto-key.cjs');

function encryptionKey() {
  return crypto.createHash('sha256').update(resolveEncryptionKey()).digest();
}

function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decryptText(value) {
  const packed = Buffer.from(String(value || ''), 'base64');
  if (packed.length < 29) throw new Error('CDE_SNAPSHOT_ENCRYPTED_VALUE_INVALID');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { decryptText, encryptText };

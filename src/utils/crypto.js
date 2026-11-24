const crypto = require('crypto');
function randomId(prefix='') { return `${prefix}${crypto.randomBytes(10).toString('hex')}`; }
function hmac(value, secret, alg='sha256') { return crypto.createHmac(alg, secret).update(value).digest('hex'); }
function encryptionKey(secret) {
  const key = Buffer.from(String(secret || ''), 'base64');

  if (key.length !== 32) {
    throw Object.assign(
      new Error('ENCRYPTION_KEY harus berupa Base64 32-byte.'),
      {code:'ENCRYPTION_KEY_INVALID'}
    );
  }

  return key;
}

function encrypt(value, secret) {
  if (typeof value !== 'string') {
    throw new TypeError('Nilai yang dienkripsi harus berupa string.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url')
  ].join('.');
}

function decrypt(value, secret) {
  const parts = String(value || '').split('.');

  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw Object.assign(
      new Error('Format data terenkripsi tidak valid.'),
      {code:'ENCRYPTED_VALUE_INVALID'}
    );
  }

  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');

  if (iv.length !== 12 || tag.length !== 16) {
    throw Object.assign(
      new Error('Metadata enkripsi tidak valid.'),
      {code:'ENCRYPTED_VALUE_INVALID'}
    );
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    iv
  );

  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');
}

module.exports = { randomId, hmac, encrypt, decrypt };

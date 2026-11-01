// Encryption at rest (AES-256-GCM, IWA-NF-003) and document signing
// (Ed25519, IWA-SR-005).
const crypto = require('node:crypto');

function createCrypto({ dataKey, signingKeyPem }) {
  const key = Buffer.from(dataKey, 'hex');
  if (key.length !== 32) throw new Error('DATA_KEY must be 32 bytes (64 hex chars) for AES-256');

  let privateKey;
  let publicKey;
  if (signingKeyPem) {
    privateKey = crypto.createPrivateKey(signingKeyPem);
    publicKey = crypto.createPublicKey(privateKey);
  } else {
    ({ privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'));
  }

  return {
    // Output format: v1:<iv>:<tag>:<ciphertext>, all base64.
    encrypt(plain) {
      if (plain == null || plain === '') return null;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
    },
    decrypt(blob) {
      if (!blob) return null;
      const [, iv, tag, ct] = blob.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
    },
    sign: (buf) => crypto.sign(null, buf, privateKey).toString('base64'),
    verify: (buf, signature) => {
      try {
        return crypto.verify(null, buf, publicKey, Buffer.from(signature, 'base64'));
      } catch {
        return false;
      }
    },
    publicKeyPem: () => publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

module.exports = { createCrypto, sha256 };

// Print the current TOTP code for a base32 secret (local demo helper).
// Usage: npm run otp -- JBSWY3DPEHPK3PXP
const { totp } = require('../src/security/auth');

const secret = process.argv[2];
if (!secret) {
  console.error('Usage: npm run otp -- <BASE32_SECRET>');
  process.exit(1);
}
const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${totp(secret)}  (valid for ${remaining}s)`);

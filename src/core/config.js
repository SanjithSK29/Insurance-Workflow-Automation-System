// Runtime configuration. Every value can be overridden per app instance
// (tests do this) or through environment variables.
const crypto = require('node:crypto');

function loadConfig(overrides = {}) {
  const env = process.env;
  return {
    port: Number(env.PORT || 3000),
    dbFile: env.IWAS_DB || ':memory:',
    // Secrets: set these in any environment that persists data, otherwise
    // encrypted columns and tokens become unreadable after a restart.
    jwtSecret: env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    dataKey: env.DATA_KEY || crypto.randomBytes(32).toString('hex'), // AES-256 key, hex
    signingKeyPem: env.SIGNING_KEY_PEM || null, // Ed25519 private key (PKCS8 PEM)
    tlsCert: env.TLS_CERT || null,
    tlsKey: env.TLS_KEY || null,
    jwtTtlSeconds: 3600,
    riskThreshold: Number(env.RISK_THRESHOLD || 60),
    quoteValidityDays: 30,
    gstRate: 0.18,
    maxUploadBytes: 10 * 1024 * 1024,
    reminderDays: [30, 15, 7],
    // Policy cancellation: short-rate retention deducted from the pro-rata
    // refund of the unexpired portion of the premium.
    cancellationFeePercent: Number(env.CANCELLATION_FEE_PERCENT || 5),
    slaHours: 48,
    rateLimit: {
      windowMs: Number(env.RATE_LIMIT_WINDOW_MS || 60_000),
      max: Number(env.RATE_LIMIT_MAX || 300),
      publicMax: Number(env.RATE_LIMIT_PUBLIC_MAX || 60),
    },
    // Account lockout after repeated failed logins (IWA-SR-002/004).
    lockout: {
      maxAttempts: Number(env.LOCKOUT_MAX_ATTEMPTS || 5),
      minutes: Number(env.LOCKOUT_MINUTES || 15),
    },
    seedDemoData: env.SEED_DEMO !== 'false',
    logLevel: env.LOG_LEVEL || 'info',
    ...overrides,
  };
}

module.exports = { loadConfig };

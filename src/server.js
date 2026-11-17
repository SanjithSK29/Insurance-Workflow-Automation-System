// Entry point: HTTP for local development, HTTPS with TLS 1.2+ when a
// certificate is configured (IWA-SR-001).
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { createApp } = require('./app');
const { seedDemo, DEMO_USERS, DEMO_PASSWORD } = require('./seed');

const RENEWAL_JOB_INTERVAL_MS = 6 * 3_600_000;

function tlsOptions(config) {
  return {
    cert: fs.readFileSync(config.tlsCert),
    key: fs.readFileSync(config.tlsKey),
    minVersion: 'TLSv1.2',
    honorCipherOrder: true,
  };
}

// With a database file, keys that change on restart make stored data unusable:
// PII can no longer be decrypted (see DEF-01), tokens and signatures stop
// verifying. Returns the variables that should be set but are not.
function missingPersistentSecrets(config, env = process.env) {
  if (!config.dbFile || config.dbFile === ':memory:') return [];
  return ['DATA_KEY', 'JWT_SECRET', 'SIGNING_KEY_PEM'].filter((name) => !env[name]);
}

async function main() {
  const { app, ctx } = createApp();
  const { config, logger } = ctx;

  const missing = missingPersistentSecrets(config);
  if (missing.length) {
    logger.warn('persistent_db_without_fixed_keys', { dbFile: config.dbFile, missing });
    console.warn(`\nWARNING: data is stored in ${config.dbFile} but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set.`
      + '\nRandom keys are generated on every start, so encrypted data, logins and document signatures will not survive a restart.'
      + '\nSet them as described in .env.example.\n');
  }

  if (config.seedDemoData && (await seedDemo(ctx))) {
    logger.info('demo_data_seeded', { users: DEMO_USERS.map((u) => u.role) });
    console.log(`\nDemo accounts (password: ${DEMO_PASSWORD})`);
    for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(12)} ${u.email}${u.mfaSecret ? `   MFA secret ${u.mfaSecret} (npm run otp -- ${u.mfaSecret})` : ''}`);
  }

  const runReminders = () => {
    try {
      ctx.services.policies.runRenewalReminders();
    } catch (err) {
      logger.error('renewal_job_failed', { error: err.message });
    }
  };
  runReminders();
  setInterval(runReminders, RENEWAL_JOB_INTERVAL_MS).unref();

  const secure = config.tlsCert && config.tlsKey;
  const server = secure ? https.createServer(tlsOptions(config), app) : http.createServer(app);
  server.listen(config.port, () => {
    console.log(`\nIWAS running on ${secure ? 'https' : 'http'}://localhost:${config.port}\n`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { tlsOptions, missingPersistentSecrets };

// Structured JSON logging with PII redaction (SAD 4.4, IWA-SR-003).
const { redactPii } = require('../security/pii');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger(level = 'info', sink = (line) => process.stdout.write(line + '\n')) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const lines = [];

  function log(lvl, msg, fields = {}) {
    if (LEVELS[lvl] < threshold) return;
    const line = redactPii(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...fields }));
    lines.push(line);
    if (lines.length > 500) lines.shift();
    sink(line);
  }

  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    recent: () => lines.slice(),
  };
}

module.exports = { createLogger };

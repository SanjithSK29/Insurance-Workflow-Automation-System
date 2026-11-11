// Persistence layer on Node's built-in SQLite. The schema mirrors the
// PostgreSQL design in the SAD: one table group per bounded context.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CUSTOMER','AGENT','UNDERWRITER','ADJUSTER','ADMIN')),
  password_hash TEXT NOT NULL,
  mfa_secret TEXT,
  last_totp_step INTEGER,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Revoked JWT ids (logout). Rows are purged once the token would have expired.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  agent_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  dob TEXT NOT NULL,
  income REAL NOT NULL,
  email_enc TEXT,
  phone_enc TEXT,
  aadhaar_enc TEXT,
  pan_enc TEXT,
  kyc_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  kyc_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  coverage_type TEXT NOT NULL,
  age INTEGER NOT NULL,
  income REAL NOT NULL,
  term INTEGER NOT NULL,
  sum_insured REAL NOT NULL,
  smoker INTEGER NOT NULL DEFAULT 0,
  premium REAL NOT NULL,
  breakdown TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  risk_score INTEGER,
  risk_flags TEXT NOT NULL DEFAULT '[]',
  declarations TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  decided_by TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  policy_number TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL REFERENCES applications(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  coverage_type TEXT NOT NULL,
  sum_insured REAL NOT NULL,
  premium REAL NOT NULL,
  term INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  nominee TEXT,
  address TEXT,
  document_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS endorsements (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id),
  changes TEXT NOT NULL,
  previous TEXT NOT NULL,
  premium_adjustment REAL NOT NULL DEFAULT 0,
  endorsed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  policy_id TEXT,
  amount REAL NOT NULL,
  base_amount REAL NOT NULL,
  tax_amount REAL NOT NULL,
  status TEXT NOT NULL,
  gateway_ref TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  invoice_document_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  owner_customer_id TEXT,
  reference_id TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  signature TEXT,
  content BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  claim_type TEXT NOT NULL,
  amount REAL NOT NULL,
  approved_amount REAL,
  incident_date TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  fraud_score INTEGER NOT NULL DEFAULT 0,
  fraud_flags TEXT NOT NULL DEFAULT '[]',
  settlement TEXT,
  workflow_instance_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_documents (
  claim_id TEXT NOT NULL REFERENCES claims(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  PRIMARY KEY (claim_id, document_id)
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  xml TEXT NOT NULL,
  deployed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (key, version)
);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  business_key TEXT NOT NULL,
  current_node TEXT,
  status TEXT NOT NULL,
  result TEXT,
  variables TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES workflow_instances(id),
  business_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  candidate_group TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_by TEXT,
  outcome TEXT,
  comment TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  customer_id TEXT,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders_sent (
  policy_id TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days_before INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, end_date, days_before)
);

CREATE TABLE IF NOT EXISTS cancellations (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id),
  reason TEXT,
  gross_refund REAL NOT NULL DEFAULT 0,
  fee REAL NOT NULL DEFAULT 0,
  refund_amount REAL NOT NULL DEFAULT 0,
  remaining_days INTEGER NOT NULL,
  cancelled_by TEXT NOT NULL,
  document_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id),
  payment_id TEXT,
  amount REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL,
  gateway_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Append-only, hash-chained audit log (IWA-F-034, IWA-NF-004).
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON workflow_tasks(status, candidate_group);
CREATE INDEX IF NOT EXISTS idx_policies_customer ON policies(customer_id);
`;

// Columns added after the first release. CREATE TABLE IF NOT EXISTS does not
// alter tables that already exist, so persistent databases (the Docker
// volume) are upgraded here.
const COLUMN_MIGRATIONS = [
  ['users', 'last_totp_step', 'INTEGER'],
  ['users', 'failed_logins', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'locked_until', 'TEXT'],
];

function migrate(raw) {
  for (const [table, column, type] of COLUMN_MIGRATIONS) {
    const columns = raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes(column)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function openDatabase(file) {
  const raw = new DatabaseSync(file);
  raw.exec(SCHEMA);
  migrate(raw);

  const cache = new Map();
  const prepare = (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = raw.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };

  return {
    raw,
    get: (sql, ...params) => prepare(sql).get(...params),
    all: (sql, ...params) => prepare(sql).all(...params),
    run: (sql, ...params) => prepare(sql).run(...params),
    transaction(fn) {
      raw.exec('BEGIN');
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => raw.close(),
  };
}

const newId = (prefix) => prefix + crypto.randomBytes(5).toString('hex').toUpperCase();
const nowIso = () => new Date().toISOString();

module.exports = { openDatabase, newId, nowIso };

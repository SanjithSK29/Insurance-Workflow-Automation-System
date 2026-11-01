// IWA-F-030..034 admin, RBAC, dashboards, reports, audit; IWA-NF-003 and IWA-SR-001..005 security.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, PASSWORD } = require('./helpers');
const { totp } = require('../src/security/auth');
const { redactPii } = require('../src/security/pii');

describe('Admin, RBAC, dashboards, reports and audit', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Admin-01: admin validates and deploys a BPMN workflow; invalid BPMN is refused', async () => {
    const list = await t.call('GET', '/admin/workflows', { token: t.tokens.ADMIN });
    assert.ok(list.body.some((w) => w.key === 'claim-approval'));
    const latest = await t.call('GET', '/admin/workflows/claim-approval/latest', { token: t.tokens.ADMIN });
    assert.ok(latest.body.model.nodes.length > 5);

    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
      <bpmn:process id="simple-review" name="Simple review">
        <bpmn:startEvent id="s"/><bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t"/>
        <bpmn:userTask id="t" name="Review" camunda:candidateGroups="ADJUSTER"/>
        <bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="e"/><bpmn:endEvent id="e"/>
      </bpmn:process></bpmn:definitions>`;
    const ok = await t.call('POST', '/admin/workflows/validate', { token: t.tokens.ADMIN, body: { xml } });
    assert.equal(ok.body.valid, true);
    const dep = await t.call('POST', '/admin/workflows', { token: t.tokens.ADMIN, body: { xml } });
    assert.equal(dep.status, 201);
    assert.equal(dep.body.key, 'simple-review');

    const broken = xml.replace('targetRef="e"', 'targetRef="missing"');
    const bad = await t.call('POST', '/admin/workflows', { token: t.tokens.ADMIN, body: { xml: broken } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'INVALID_BPMN');
    assert.ok(bad.body.details.some((d) => d.includes('missing')));
  });

  test('TC-RBAC-01: unauthorized access is denied for every module', async () => {
    const cases = [
      ['GET', '/admin/audit', ['CUSTOMER', 'AGENT', 'UNDERWRITER', 'ADJUSTER']],
      ['POST', '/admin/workflows', ['CUSTOMER', 'AGENT', 'UNDERWRITER', 'ADJUSTER']],
      ['GET', '/admin/users', ['CUSTOMER', 'AGENT', 'UNDERWRITER', 'ADJUSTER']],
      ['GET', '/admin/reports/policies', ['CUSTOMER', 'AGENT', 'ADJUSTER']],
      ['GET', '/admin/dashboard', ['CUSTOMER', 'AGENT']],
      ['POST', '/applications/A0000000000/decision', ['CUSTOMER', 'AGENT', 'ADJUSTER', 'ADMIN']],
      ['POST', '/claims/C0000000000/settle', ['CUSTOMER', 'AGENT', 'UNDERWRITER', 'ADMIN']],
      ['GET', '/workflow/tasks', ['CUSTOMER', 'AGENT']],
    ];
    for (const [method, url, roles] of cases) {
      for (const role of roles) {
        const res = await t.call(method, url, { token: t.tokens[role], body: method === 'POST' ? {} : undefined });
        assert.equal(res.status, 403, `${role} ${method} ${url}`);
      }
    }
    const anon = await t.call('GET', '/policies');
    assert.equal(anon.status, 401);
    const forged = await t.call('GET', '/policies', { token: t.tokens.CUSTOMER.slice(0, -3) + 'abc' });
    assert.equal(forged.status, 401);

    // Horizontal access: one customer cannot read another's policy.
    const a = await t.newCustomer('rbac-a');
    const b = await t.newCustomer('rbac-b');
    const { policy } = await t.buyPolicy(a);
    assert.equal((await t.call('GET', `/policies/${policy.policyId}`, { token: b.token })).status, 403);
    assert.equal((await t.call('GET', `/documents/${policy.documentId}`, { token: b.token })).status, 403);
    assert.ok(t.ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'ACCESS_DENIED'"), 'denials are audited');
  });

  test('TC-Dash-01: dashboard with SLA metrics, claim backlog and policy counts loads in under 3s', async () => {
    const started = Date.now();
    const res = await t.call('GET', '/admin/dashboard', { token: t.tokens.ADMIN });
    assert.ok(Date.now() - started < 3000);
    assert.equal(res.status, 200);
    assert.ok('backlog' in res.body.claims);
    assert.ok('breachedTasks' in res.body.sla);
    assert.ok(res.body.policies.active >= 1);
  });

  test('TC-Report-01: reports export as valid CSV and PDF', async () => {
    const csv = await t.call('GET', '/admin/reports/policies?format=csv', { token: t.tokens.ADMIN });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const lines = csv.body.toString('utf8').trim().split('\r\n');
    assert.equal(lines[0], 'policy_number,customer,coverage_type,sum_insured,premium,start_date,end_date,status,version');
    assert.ok(lines.length >= 2);
    assert.ok(lines.slice(1).every((l) => l.split(',').length === 9));

    const pdf = await t.call('GET', '/admin/reports/claims?format=pdf', { token: t.tokens.ADMIN });
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.toString('latin1').trimEnd().endsWith('%%EOF'));
    assert.equal((await t.call('GET', '/admin/reports/policies?format=xml', { token: t.tokens.ADMIN })).status, 400);
  });

  test('TC-Audit-01: audit log is append-only and tamper-evident', async () => {
    const before = await t.call('GET', '/admin/audit/verify', { token: t.tokens.ADMIN });
    assert.equal(before.body.valid, true);
    assert.ok(before.body.entries > 5);

    assert.throws(() => t.ctx.db.run("UPDATE audit_log SET actor = 'mallory' WHERE seq = 2"), /append-only/);
    assert.throws(() => t.ctx.db.run('DELETE FROM audit_log WHERE seq = 2'), /append-only/);

    // Simulate an attacker with raw DB access who drops the trigger first.
    t.ctx.db.raw.exec('DROP TRIGGER audit_log_no_update');
    t.ctx.db.run("UPDATE audit_log SET details = '{\"forged\":true}' WHERE seq = 3");
    const after = await t.call('GET', '/admin/audit/verify', { token: t.tokens.ADMIN });
    assert.equal(after.body.valid, false);
    assert.equal(after.body.brokenAt, 3);
  });
});

describe('Security requirements', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Sec-01: PII is encrypted at rest with AES-256-GCM', async () => {
    const c = await t.newCustomer('enc1', { aadhaar: '298765432101', pan: 'ZYXPW9876Q', phone: '9988776655' });
    const raw = t.ctx.db.get('SELECT * FROM customers WHERE id = ?', c.customerId);
    const rowText = JSON.stringify(raw);
    for (const secret of ['298765432101', 'ZYXPW9876Q', '9988776655']) assert.ok(!rowText.includes(secret), `${secret} stored in clear`);
    assert.match(raw.aadhaar_enc, /^v1:/);
    assert.equal(t.ctx.crypto.decrypt(raw.aadhaar_enc), '298765432101');
    const tampered = raw.aadhaar_enc.slice(0, -4) + 'AAAA';
    assert.throws(() => t.ctx.crypto.decrypt(tampered), 'GCM detects tampering');
  });

  test('TC-Sec-MFA-01: MFA is enforced for admin and underwriter roles', async () => {
    for (const role of ['ADMIN', 'UNDERWRITER']) {
      const u = t.users[role];
      const noOtp = await t.call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
      assert.equal(noOtp.status, 401);
      assert.equal(noOtp.body.code, 'MFA_REQUIRED');
      const wrong = await t.call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, otp: '000000' } });
      assert.equal(wrong.body.code, 'MFA_INVALID');
      // The harness already used the current step for this user; replay protection
      // refuses it, so log in with the next step's code (inside the drift window).
      const ok = await t.call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, otp: totp(u.mfaSecret, Date.now() + 30_000) } });
      assert.equal(ok.status, 200);
    }
    const customer = await t.call('POST', '/auth/login', { body: { email: t.users.CUSTOMER.email, password: PASSWORD } });
    assert.equal(customer.status, 200, 'customers log in without MFA');
    // RFC 6238 test vector (SHA-1, T=59s): secret "12345678901234567890".
    assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
  });

  test('TC-Sec-PII-01: PII is masked in the UI/API and logs except for authorized roles', async () => {
    const c = await t.newCustomer('pii1', { aadhaar: '234598761111', pan: 'PQRPS5555T', phone: '9876512345', email: 'pii1@test.local' });
    const own = await t.call('GET', `/customers/${c.customerId}`, { token: c.token });
    assert.equal(own.body.aadhaar, 'XXXX-XXXX-1111');
    assert.equal(own.body.pan, 'XXXXXX555T');
    assert.equal(own.body.phone, '******2345');
    assert.equal(own.body.piiMasked, true);

    const uw = await t.call('GET', `/customers/${c.customerId}`, { token: t.tokens.UNDERWRITER });
    assert.equal(uw.body.aadhaar, '234598761111');
    const adj = await t.call('GET', `/customers/${c.customerId}`, { token: t.tokens.ADJUSTER });
    assert.equal(adj.body.aadhaar, 'XXXX-XXXX-1111');

    const logged = redactPii('user pii1@test.local aadhaar 2345 9876 1111 pan PQRPS5555T phone +91 9876512345');
    for (const s of ['pii1@test.local', '2345 9876 1111', 'PQRPS5555T', '9876512345']) assert.ok(!logged.includes(s), s);
    const auditText = JSON.stringify(t.ctx.db.all('SELECT details FROM audit_log'));
    assert.ok(!auditText.includes('234598761111'));
  });

  test('TC-Sec-RL-01: rate limiting triggers on public APIs', async () => {
    // Dedicated instance with a small public limit (the harness itself uses 5 logins).
    const rl = await startApp({ rateLimit: { windowMs: 60_000, max: 1000, publicMax: 10 } });
    let limited;
    try {
      for (let i = 0; i < 20; i++) {
        const res = await rl.call('POST', '/quote', { body: { age: 30, income: 500000, coverageType: 'health' } });
        if (res.status === 429) { limited = res; break; }
      }
    } finally {
      await rl.close();
    }
    assert.ok(limited, 'expected HTTP 429');
    assert.equal(limited.body.code, 'RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });

  test('TC-Sec-Sign-01: issued documents carry a valid signature and tampering is detected', async () => {
    const doc = t.ctx.services.documents.generateSignedPdf({ kind: 'POLICY', filename: 'x.pdf', title: 'X', lines: ['Policy IWAS-TEST'] });
    assert.equal(t.ctx.services.documents.verify(doc.id).signatureValid, true);
    const row = t.ctx.db.get('SELECT content FROM documents WHERE id = ?', doc.id);
    const altered = Buffer.from(row.content);
    altered[altered.length - 20] ^= 0xff;
    t.ctx.db.run('UPDATE documents SET content = ? WHERE id = ?', altered, doc.id);
    const v = t.ctx.services.documents.verify(doc.id);
    assert.equal(v.signatureValid, false);
    assert.equal(v.integrityValid, false);
  });

  test('TC-Sec-TLS-01: HTTPS server enforces TLS 1.2 minimum and HSTS is sent', async () => {
    const { tlsOptions } = require('../src/server');
    const fs = require('node:fs');
    const orig = fs.readFileSync;
    fs.readFileSync = () => Buffer.from('test');
    try {
      assert.equal(tlsOptions({ tlsCert: 'c', tlsKey: 'k' }).minVersion, 'TLSv1.2');
    } finally {
      fs.readFileSync = orig;
    }
    const res = await t.call('GET', '/health');
    assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('Authentication hardening', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Sec-MFA-02: a TOTP code cannot be replayed', async () => {
    const u = t.ctx.services.users.createUser({ email: 'replay@test.local', name: 'Replay Admin', role: 'ADMIN', password: PASSWORD });
    const code = totp(u.mfaSecret);
    const first = await t.call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, otp: code } });
    assert.equal(first.status, 200);
    const replay = await t.call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, otp: code } });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'MFA_INVALID');
    const audited = t.ctx.db.get("SELECT details FROM audit_log WHERE action = 'MFA_FAILED' AND actor = ? ORDER BY seq DESC", u.id);
    assert.equal(JSON.parse(audited.details).replay, true, 'replay attempts are audited as such');
  });

  test('TC-Sec-Lock-01: account locks after repeated failures and an admin can unlock it', async () => {
    const email = 'lockme@test.local';
    await t.call('POST', '/auth/register', { body: { email, name: 'Lock Me', password: PASSWORD } });
    for (let i = 0; i < 5; i++) {
      const res = await t.call('POST', '/auth/login', { body: { email, password: 'wrong-password' } });
      assert.equal(res.status, 401);
    }
    const locked = await t.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(locked.status, 429, 'correct password is refused while locked');
    assert.equal(locked.body.code, 'ACCOUNT_LOCKED');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);

    const user = t.ctx.db.get('SELECT id FROM users WHERE email = ?', email);
    const list = await t.call('GET', '/admin/users', { token: t.tokens.ADMIN });
    assert.equal(list.body.find((x) => x.id === user.id).locked, true);
    const unlock = await t.call('PATCH', `/admin/users/${user.id}`, { token: t.tokens.ADMIN, body: { unlock: true } });
    assert.equal(unlock.body.locked, false);
    assert.equal((await t.call('POST', '/auth/login', { body: { email, password: PASSWORD } })).status, 200);
  });

  test('TC-Sec-Lock-02: a successful login resets the failure counter', async () => {
    const email = 'reset@test.local';
    await t.call('POST', '/auth/register', { body: { email, name: 'Reset Me', password: PASSWORD } });
    for (let i = 0; i < 4; i++) await t.call('POST', '/auth/login', { body: { email, password: 'nope-nope' } });
    assert.equal((await t.call('POST', '/auth/login', { body: { email, password: PASSWORD } })).status, 200);
    for (let i = 0; i < 4; i++) await t.call('POST', '/auth/login', { body: { email, password: 'nope-nope' } });
    assert.equal((await t.call('POST', '/auth/login', { body: { email, password: PASSWORD } })).status, 200, 'not locked: counter was reset');
  });

  test('TC-Sec-Mig-01: databases created before the hardening columns are migrated on open', () => {
    const { DatabaseSync } = require('node:sqlite');
    const { openDatabase } = require('../src/core/db');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iwas-')), 'old.db');
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, mfa_secret TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)");
    old.close();
    const db = openDatabase(file);
    const cols = db.all('PRAGMA table_info(users)').map((c) => c.name);
    db.close();
    for (const c of ['last_totp_step', 'failed_logins', 'locked_until']) assert.ok(cols.includes(c), c);
  });
});

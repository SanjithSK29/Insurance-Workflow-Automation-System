// IWA-F-020..024 claims, fraud, settlement, notifications; IWA-F-021/030 BPMN workflow.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, pdfDoc } = require('./helpers');
const { computeSettlement } = require('../src/modules/settlement');
const { today } = require('../src/core/util');

const DEFAULT_BPMN = fs.readFileSync(path.join(__dirname, '..', 'src', 'workflow', 'claim-approval.bpmn'), 'utf8');

describe('Claims processing and workflow', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  const fileClaim = (c, policy, body = {}) => t.call('POST', '/claims', {
    token: c.token,
    body: { policyId: policy.policyId, claimType: 'hospitalization', amount: 40000, incidentDate: today(), description: 'Admitted for 2 days', documents: [pdfDoc()], ...body },
  });
  const decide = (claimId, role, outcome, extra = {}) => t.call('POST', `/claims/${claimId}/decision`, { token: t.tokens[role], body: { outcome, ...extra } });

  test('TC-Claim-01: customer registers a claim with supporting documents and gets a claim ID', async () => {
    const c = await t.newCustomer('cl1');
    const { policy } = await t.buyPolicy(c);
    const res = await fileClaim(c, policy);
    assert.equal(res.status, 201);
    assert.match(res.body.claimId, /^C[0-9A-F]{10}$/);
    assert.equal(res.body.status, 'UNDER_REVIEW');
    assert.ok(res.body.eta);
    const detail = await t.call('GET', `/claims/${res.body.claimId}`, { token: c.token });
    assert.equal(detail.body.documents.length, 1);
    assert.equal(detail.body.fraudFlags, undefined, 'fraud details hidden from customers');
  });

  test('TC-Claim-02: invalid claims are rejected (size limit, file type, ownership, dates)', async () => {
    const c = await t.newCustomer('cl2');
    const other = await t.newCustomer('cl2b');
    const { policy } = await t.buyPolicy(c);

    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);
    big.write('%PDF', 0, 'latin1');
    const tooBig = await fileClaim(c, policy, { documents: [{ filename: 'big.pdf', mime: 'application/pdf', contentBase64: big.toString('base64') }] });
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.code, 'FILE_TOO_LARGE');

    const exe = await fileClaim(c, policy, { documents: [{ filename: 'x.exe', mime: 'application/x-msdownload', contentBase64: 'TVqQ' }] });
    assert.equal(exe.status, 400);
    const spoofed = await fileClaim(c, policy, { documents: [{ filename: 'x.pdf', mime: 'application/pdf', contentBase64: Buffer.from('MZ not a pdf').toString('base64') }] });
    assert.equal(spoofed.status, 400);

    const notMine = await fileClaim(other, policy);
    assert.equal(notMine.status, 403);
    const future = await fileClaim(c, policy, { incidentDate: '2999-01-01' });
    assert.equal(future.status, 422);
    const wrongType = await fileClaim(c, policy, { claimType: 'theft' });
    assert.equal(wrongType.status, 422);
    const missing = await t.call('POST', '/claims', { token: c.token, body: { policyId: 'PNOPE', claimType: 'accident', amount: 1, incidentDate: today() } });
    assert.equal(missing.status, 404);
  });

  test('TC-WF-01: low-value claim needs only adjuster approval; high-value also needs senior approval', async () => {
    const c = await t.newCustomer('wf1');
    const { policy } = await t.buyPolicy(c, { sumInsured: 1_000_000 });

    const low = await fileClaim(c, policy, { amount: 50000 });
    let r = await decide(low.body.claimId, 'ADJUSTER', 'approve');
    assert.equal(r.status, 200);
    assert.equal(r.body.workflow.status, 'COMPLETED');
    assert.equal(r.body.claim.status, 'APPROVED');

    const high = await fileClaim(c, policy, { amount: 250000, incidentDate: today(), claimType: 'accident' });
    r = await decide(high.body.claimId, 'ADJUSTER', 'approve');
    assert.equal(r.body.workflow.status, 'WAITING');
    assert.equal(r.body.workflow.task.name, 'Senior claims approval');
    assert.equal(r.body.claim.status, 'UNDER_REVIEW');

    const wrongRole = await decide(high.body.claimId, 'ADJUSTER', 'approve');
    assert.equal(wrongRole.status, 403, 'adjuster cannot do the senior step');
    r = await decide(high.body.claimId, 'ADMIN', 'approve');
    assert.equal(r.body.claim.status, 'APPROVED');

    const tasks = await t.call('GET', `/claims/${high.body.claimId}`, { token: t.tokens.ADJUSTER });
    assert.deepEqual(tasks.body.tasks.map((x) => x.name), ['Adjuster review', 'Senior claims approval']);
  });

  test('TC-WF-02: rejection ends the workflow and a newly deployed workflow version changes routing', async () => {
    const c = await t.newCustomer('wf2');
    const { policy } = await t.buyPolicy(c, { sumInsured: 1_000_000 });
    const rejected = await fileClaim(c, policy, { amount: 20000 });
    const r = await decide(rejected.body.claimId, 'ADJUSTER', 'reject', { comment: 'Not covered' });
    assert.equal(r.body.claim.status, 'REJECTED');

    // Lower the senior-approval limit to 10,000 and deploy as version 2.
    const v2 = DEFAULT_BPMN.replace('amount &gt; 100000', 'amount &gt; 10000');
    const dep = await t.call('POST', '/admin/workflows', { token: t.tokens.ADMIN, body: { xml: v2 } });
    assert.equal(dep.status, 201);
    assert.equal(dep.body.version, 2);
    const claim = await fileClaim(c, policy, { amount: 20000, claimType: 'accident' });
    const step = await decide(claim.body.claimId, 'ADJUSTER', 'approve');
    assert.equal(step.body.workflow.task.name, 'Senior claims approval');
    await t.call('POST', '/admin/workflows', { token: t.tokens.ADMIN, body: { xml: DEFAULT_BPMN } }); // restore
  });

  test('TC-Fraud-01: duplicate claim raises a fraud flag and routes to fraud investigation', async () => {
    const c = await t.newCustomer('fr1');
    const { policy } = await t.buyPolicy(c);
    const first = await fileClaim(c, policy, { amount: 30000 });
    assert.ok(first.status === 201);
    const dup = await fileClaim(c, policy, { amount: 30000 });
    const detail = await t.call('GET', `/claims/${dup.body.claimId}`, { token: t.tokens.ADJUSTER });
    assert.ok(detail.body.fraudFlags.some((f) => f.code === 'DUPLICATE_CLAIM'));
    assert.ok(detail.body.fraudScore >= 50);
    assert.equal(detail.body.tasks[0].name, 'Fraud investigation');
    const audit = t.ctx.db.get("SELECT * FROM audit_log WHERE action = 'FRAUD_FLAG_RAISED' AND entity_id = ?", dup.body.claimId);
    assert.ok(audit);
  });

  test('TC-Settle-01: settlement amount matches the policy formula', async () => {
    // Unit check of the formula (health: 5,000 deductible, 10% co-pay).
    const s = computeSettlement({ coverageType: 'health', approvedAmount: 40000, sumInsured: 500000, alreadySettled: 0 });
    assert.equal(s.payableAmount, (40000 - 5000) * 0.9);
    const capped = computeSettlement({ coverageType: 'motor', approvedAmount: 900000, sumInsured: 600000, alreadySettled: 100000 });
    assert.equal(capped.payableAmount, 500000 - 2500);
    assert.equal(computeSettlement({ coverageType: 'home', approvedAmount: 4000, sumInsured: 1e6 }).payableAmount, 0);

    // End to end, with the adjuster approving a reduced amount.
    const c = await t.newCustomer('st1');
    const { policy } = await t.buyPolicy(c);
    const claim = await fileClaim(c, policy, { amount: 60000 });
    const r = await decide(claim.body.claimId, 'ADJUSTER', 'approve', { approvedAmount: 50000 });
    assert.equal(r.body.claim.settlement.payableAmount, (50000 - 5000) * 0.9);
    const settled = await t.call('POST', `/claims/${claim.body.claimId}/settle`, { token: t.tokens.ADJUSTER });
    assert.equal(settled.status, 200);
    assert.equal(settled.body.status, 'SETTLED');
    assert.ok(settled.body.settlement.payoutReference);
    const verify = await t.call('GET', `/documents/${settled.body.settlement.documentId}/verify`, { token: c.token });
    assert.equal(verify.body.signatureValid, true, 'settlement letter is digitally signed');
  });

  test('TC-Notify-01: claimant is notified at every status change', async () => {
    const c = await t.newCustomer('nt1', { email: 'nt1@test.local' });
    const { policy } = await t.buyPolicy(c);
    const claim = await fileClaim(c, policy, { amount: 10000 });
    await decide(claim.body.claimId, 'ADJUSTER', 'approve');
    await t.call('POST', `/claims/${claim.body.claimId}/settle`, { token: t.tokens.ADJUSTER });

    const inbox = await t.call('GET', '/notifications', { token: c.token });
    const types = inbox.body.map((n) => n.type);
    for (const s of ['CLAIM_REGISTERED', 'CLAIM_UNDER_REVIEW', 'CLAIM_APPROVED', 'CLAIM_SETTLED']) assert.ok(types.includes(s), s);
    const emails = t.ctx.db.all("SELECT type FROM notifications WHERE customer_id = ? AND channel = 'EMAIL' AND type LIKE 'CLAIM_%'", c.customerId);
    assert.equal(emails.length, 4);
  });
});

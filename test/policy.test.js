// IWA-F-010 issuance, IWA-F-011 renewal, IWA-F-012 endorsement, IWA-F-013 invoices.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { addDays, today } = require('../src/core/util');

describe('Policy issuance and management', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Policy-01: successful payment issues a policy with a signed PDF', async () => {
    const c = await t.newCustomer('pol1');
    const { policy, payment } = await t.buyPolicy(c);
    assert.match(policy.policyNumber, /^IWAS-\d{4}-\d{6}$/);
    assert.equal(policy.status, 'ACTIVE');
    assert.equal(payment.status, 'CAPTURED');

    const pdf = await t.call('GET', `/documents/${policy.documentId}`, { token: c.token });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.toString('latin1').includes(policy.policyNumber), 'PDF contains the policy number');
    assert.ok(pdf.headers.get('x-document-signature'));

    const verify = await t.call('GET', `/documents/${policy.documentId}/verify`, { token: c.token });
    assert.equal(verify.body.signatureValid, true);
    assert.equal(verify.body.integrityValid, true);
  });

  test('TC-Policy-02: no policy is issued when payment fails, and retries recover transient failures', async () => {
    const c = await t.newCustomer('pol2');
    const q = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health' } });
    const app = await t.call('POST', '/applications', { token: c.token, body: { quoteId: q.body.quoteId } });
    const declined = await t.call('POST', '/payments', { token: c.token, body: { applicationId: app.body.applicationId, paymentToken: 'tok_decline' } });
    assert.equal(declined.status, 402);
    assert.equal(declined.body.code, 'PAYMENT_FAILED');
    assert.equal((await t.call('GET', '/policies', { token: c.token })).body.length, 0);

    const flaky = await t.call('POST', '/payments', { token: c.token, body: { applicationId: app.body.applicationId, paymentToken: 'tok_flaky' } });
    assert.equal(flaky.status, 201);
    const payments = await t.call('GET', '/payments', { token: c.token });
    assert.equal(payments.body.find((p) => p.paymentId === flaky.body.paymentId).attempts, 2);

    const twice = await t.call('POST', '/payments', { token: c.token, body: { applicationId: app.body.applicationId, paymentToken: 'tok_success' } });
    assert.equal(twice.status, 409, 'cannot issue twice');
  });

  test('TC-Invoice-01: invoice PDF with tax breakup is generated and stored', async () => {
    const c = await t.newCustomer('inv1');
    const { payment, quote } = await t.buyPolicy(c);
    assert.ok(payment.invoiceDocumentId);
    assert.ok(Math.abs(payment.baseAmount + payment.taxAmount - quote.premium) < 0.01);
    assert.ok(Math.abs(payment.taxAmount - quote.breakdown.gst) < 0.05);
    const inv = await t.call('GET', `/documents/${payment.invoiceDocumentId}`, { token: c.token });
    const text = inv.body.toString('latin1');
    assert.ok(text.includes('TAX INVOICE'));
    assert.ok(text.includes('CGST @ 9%'));
    assert.ok(text.includes('SGST @ 9%'));
  });

  test('TC-Renew-01: reminders are sent 30, 15 and 7 days before expiry, once each', async () => {
    const c = await t.newCustomer('ren1', { email: 'ren1@test.local' });
    const { policy } = await t.buyPolicy(c);
    const base = today();
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', addDays(base, 30), policy.policyId);
    const run = async (asOf) => (await t.call('POST', '/admin/jobs/renewal-reminders', { token: t.tokens.ADMIN, body: { asOf } })).body.sent
      .filter((s) => s.policyId === policy.policyId);

    assert.equal((await run(addDays(base, 0)))[0]?.reminder, 30);
    assert.equal((await run(addDays(base, 1))).length, 0, 'not repeated');
    assert.equal((await run(addDays(base, 15)))[0]?.reminder, 15);
    assert.equal((await run(addDays(base, 23)))[0]?.reminder, 7);
    assert.equal((await run(addDays(base, 25))).length, 0);

    const reminders = t.ctx.db.all("SELECT channel FROM notifications WHERE customer_id = ? AND type = 'RENEWAL_REMINDER'", c.customerId);
    assert.equal(reminders.filter((r) => r.channel === 'IN_APP').length, 3);
    assert.equal(reminders.filter((r) => r.channel === 'EMAIL').length, 3);
    assert.equal(reminders.filter((r) => r.channel === 'SMS').length, 3);
  });

  test('policy renewal extends the period after payment', async () => {
    const c = await t.newCustomer('ren2');
    const { policy } = await t.buyPolicy(c);
    const tooEarly = await t.call('POST', `/policies/${policy.policyId}/renew`, { token: c.token, body: { paymentToken: 'tok_success' } });
    assert.equal(tooEarly.status, 409);
    const end = addDays(today(), 10);
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', end, policy.policyId);
    const res = await t.call('POST', `/policies/${policy.policyId}/renew`, { token: c.token, body: { paymentToken: 'tok_success' } });
    assert.equal(res.status, 200);
    assert.ok(res.body.policy.endDate > end);
    assert.equal(res.body.policy.version, 2);
    assert.ok(res.body.invoiceDocumentId);
  });

  test('TC-Endorse-01: endorsement is applied and recorded in the audit trail', async () => {
    const c = await t.newCustomer('end1');
    const { policy } = await t.buyPolicy(c);
    const res = await t.call('POST', `/policies/${policy.policyId}/endorse`, { token: c.token, body: { nominee: 'Meera Kumar', sumInsured: 700000 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.policy.nominee, 'Meera Kumar');
    assert.equal(res.body.policy.sumInsured, 700000);
    assert.equal(res.body.policy.version, 2);
    assert.ok(res.body.premiumAdjustment > 0, 'higher cover costs more pro rata');

    const detail = await t.call('GET', `/policies/${policy.policyId}`, { token: c.token });
    assert.equal(detail.body.endorsements.length, 1);
    assert.equal(detail.body.endorsements[0].previous.sumInsured, 500000);

    const audit = await t.call('GET', `/admin/audit?entity=policy&entityId=${policy.policyId}`, { token: t.tokens.ADMIN });
    const entry = audit.body.find((a) => a.action === 'POLICY_ENDORSED');
    assert.ok(entry, 'endorsement audited');

    const bad = await t.call('POST', `/policies/${policy.policyId}/endorse`, { token: c.token, body: { premium: 1 } });
    assert.equal(bad.status, 400);
  });
});

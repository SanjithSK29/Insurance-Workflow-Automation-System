// IWA-F-010 / IWA-F-011 / IWA-F-013: premium payments, renewals and invoices
// under failure and concurrency (owner: Samarth).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { addDays, today } = require('../src/core/util');

describe('Payments hardening', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  async function approvedApplication(tag) {
    const c = await t.newCustomer(tag);
    const q = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health' } });
    const app = await t.call('POST', '/applications', { token: c.token, body: { quoteId: q.body.quoteId } });
    assert.equal(app.body.status, 'APPROVED');
    return { c, applicationId: app.body.applicationId };
  }

  test('TC-Pay-03: a double-submitted premium payment charges once and issues one policy (DEF-08)', async () => {
    const { c, applicationId } = await approvedApplication('dbl1');
    // tok_flaky makes the gateway time out once, so the first request is still
    // in flight when the second arrives, which is what a double-click does.
    const pay = () => t.call('POST', '/payments', { token: c.token, body: { applicationId, paymentToken: 'tok_flaky' } });
    const results = await Promise.all([pay(), pay()]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(results.find((r) => r.status === 409).body.code, 'PAYMENT_IN_PROGRESS');

    const captured = t.ctx.db.all("SELECT * FROM payments WHERE reference_id = ? AND status = 'CAPTURED'", applicationId);
    assert.equal(captured.length, 1, 'customer charged exactly once');
    const policies = t.ctx.db.all('SELECT * FROM policies WHERE application_id = ?', applicationId);
    assert.equal(policies.length, 1, 'exactly one policy issued');

    // Once the first payment has finished, a retry is refused as already issued.
    const again = await pay();
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ALREADY_ISSUED');
  });

  test('TC-Pay-04: a double-submitted renewal charges once and extends the policy once (DEF-08)', async () => {
    const c = await t.newCustomer('dbl2');
    const { policy } = await t.buyPolicy(c);
    const end = addDays(today(), 10);
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', end, policy.policyId);

    const renew = () => t.call('POST', `/policies/${policy.policyId}/renew`, { token: c.token, body: { paymentToken: 'tok_flaky' } });
    const results = await Promise.all([renew(), renew()]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).body.code, 'PAYMENT_IN_PROGRESS');

    const renewals = t.ctx.db.all("SELECT * FROM payments WHERE policy_id = ? AND purpose = 'RENEWAL' AND status = 'CAPTURED'", policy.policyId);
    assert.equal(renewals.length, 1, 'renewal premium charged exactly once');
    const row = t.ctx.db.get('SELECT version FROM policies WHERE id = ?', policy.policyId);
    assert.equal(row.version, 2);
  });

  test('TC-Pay-05: a failed payment releases the lock so the customer can retry', async () => {
    const { c, applicationId } = await approvedApplication('dbl3');
    const declined = await t.call('POST', '/payments', { token: c.token, body: { applicationId, paymentToken: 'tok_decline' } });
    assert.equal(declined.status, 402);
    const retry = await t.call('POST', '/payments', { token: c.token, body: { applicationId, paymentToken: 'tok_success' } });
    assert.equal(retry.status, 201);
  });
});

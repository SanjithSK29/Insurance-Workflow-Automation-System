const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { addDays, today } = require('../src/core/util');

describe('Policy Reinstatement and Cancellation Quotes (Sprint 4)', () => {
  let env;

  before(async () => {
    env = await startApp();
  });

  after(async () => {
    await env.close();
  });

  it('TC-Reinstate-01: Preview cancellation quote calculates pro-rata refund and fee', async () => {
    const cust = await env.newCustomer('reinstate-01');
    const pol = await env.buyPolicy(cust, { coverageType: 'health', sumInsured: 500_000, term: 1 });

    const quoteRes = await env.call('GET', `/policies/${pol.policyId}/cancellation-quote`, { token: cust.token });
    assert.equal(quoteRes.status, 200);
    assert.equal(quoteRes.body.policyId, pol.policyId);
    assert.ok(quoteRes.body.grossRefund > 0);
    assert.ok(quoteRes.body.fee >= 0);
    assert.equal(quoteRes.body.refundAmount, quoteRes.body.grossRefund - quoteRes.body.fee);
    assert.ok(quoteRes.body.remainingDays > 0);
  });

  it('TC-Reinstate-02: Cancellation quote rejects if policy is already expired or cancelled', async () => {
    const cust = await env.newCustomer('reinstate-02');
    const pol = await env.buyPolicy(cust, { coverageType: 'motor', sumInsured: 300_000, term: 1 });

    // Cancel policy first
    const cancelRes = await env.call('POST', `/policies/${pol.policyId}/cancel`, {
      token: cust.token,
      body: { reason: 'Vehicle sold' },
    });
    assert.equal(cancelRes.status, 200);

    // Now request quote
    const quoteRes = await env.call('GET', `/policies/${pol.policyId}/cancellation-quote`, { token: cust.token });
    assert.equal(quoteRes.status, 409);
    assert.equal(quoteRes.body.code, 'NOT_ACTIVE');
  });

  it('TC-Reinstate-03: Reinstatement of expired policy within 30 days succeeds with fee and health declaration', async () => {
    const cust = await env.newCustomer('reinstate-03');
    const pol = await env.buyPolicy(cust, { coverageType: 'health', sumInsured: 500_000, term: 1 });

    // Set end_date to 10 days ago (within 30 days grace period) and status to EXPIRED
    const expiredDate = addDays(today(), -10);
    env.ctx.db.run("UPDATE policies SET end_date = ?, status = 'EXPIRED' WHERE id = ?", expiredDate, pol.policyId);

    const reinstateRes = await env.call('POST', `/policies/${pol.policyId}/reinstate`, {
      token: cust.token,
      body: { paymentToken: 'tok_success', healthDeclaration: true },
    });

    assert.equal(reinstateRes.status, 200);
    assert.equal(reinstateRes.body.policy.status, 'ACTIVE');
    assert.equal(reinstateRes.body.reinstatementFee, 500);
    assert.ok(reinstateRes.body.reinstatementId);
    assert.ok(reinstateRes.body.invoiceDocumentId);

    // Verify reinstatement audit trail in database
    const reinstatement = env.ctx.db.get('SELECT * FROM reinstatements WHERE policy_id = ?', pol.policyId);
    assert.ok(reinstatement);
    assert.equal(reinstatement.reinstatement_fee, 500);
    assert.equal(reinstatement.days_lapsed, 10);
  });

  it('TC-Reinstate-04: Reinstatement fails when health declaration is false or omitted', async () => {
    const cust = await env.newCustomer('reinstate-04');
    const pol = await env.buyPolicy(cust, { coverageType: 'life', sumInsured: 1_000_000, term: 1 });

    const expiredDate = addDays(today(), -5);
    env.ctx.db.run("UPDATE policies SET end_date = ?, status = 'EXPIRED' WHERE id = ?", expiredDate, pol.policyId);

    const resMissing = await env.call('POST', `/policies/${pol.policyId}/reinstate`, {
      token: cust.token,
      body: { paymentToken: 'tok_success' },
    });
    assert.equal(resMissing.status, 422);
    assert.equal(resMissing.body.code, 'HEALTH_DECLARATION_REQUIRED');

    const resFalse = await env.call('POST', `/policies/${pol.policyId}/reinstate`, {
      token: cust.token,
      body: { paymentToken: 'tok_success', healthDeclaration: false },
    });
    assert.equal(resFalse.status, 422);
    assert.equal(resFalse.body.code, 'HEALTH_DECLARATION_REQUIRED');
  });

  it('TC-Reinstate-05: Reinstatement fails when grace period (>30 days) has passed', async () => {
    const cust = await env.newCustomer('reinstate-05');
    const pol = await env.buyPolicy(cust, { coverageType: 'health', sumInsured: 500_000, term: 1 });

    // Set end_date to 35 days ago (grace period is 30 days)
    const longExpiredDate = addDays(today(), -35);
    env.ctx.db.run("UPDATE policies SET end_date = ?, status = 'EXPIRED' WHERE id = ?", longExpiredDate, pol.policyId);

    const res = await env.call('POST', `/policies/${pol.policyId}/reinstate`, {
      token: cust.token,
      body: { paymentToken: 'tok_success', healthDeclaration: true },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'GRACE_PERIOD_EXCEEDED');
  });

  it('TC-Reinstate-06: Reinstatement fails if policy is currently ACTIVE', async () => {
    const cust = await env.newCustomer('reinstate-06');
    const pol = await env.buyPolicy(cust, { coverageType: 'home', sumInsured: 2_000_000, term: 1 });

    const res = await env.call('POST', `/policies/${pol.policyId}/reinstate`, {
      token: cust.token,
      body: { paymentToken: 'tok_success', healthDeclaration: true },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NOT_EXPIRED');
  });
});

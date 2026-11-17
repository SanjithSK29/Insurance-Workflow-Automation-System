// IWA-F-012 endorsements and IWA-F-014 cancellation: the money side.
// Premium differences must be collected or refunded, and cancellation refunds
// must follow the premium actually paid for each period (owner: Samarth).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { addDays, addYears, daysBetween, today, round2 } = require('../src/core/util');

describe('Endorsement and cancellation payments', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  const endorse = (c, policyId, body) => t.call('POST', `/policies/${policyId}/endorse`, { token: c.token, body });
  const policyRow = (id) => t.ctx.db.get('SELECT * FROM policies WHERE id = ?', id);

  test('TC-Endorse-03: raising the sum insured collects the premium difference first (DEF-09)', async () => {
    const c = await t.newCustomer('end3');
    const { policy } = await t.buyPolicy(c);

    const unpaid = await endorse(c, policy.policyId, { sumInsured: 700000 });
    assert.equal(unpaid.status, 402);
    assert.equal(unpaid.body.code, 'PAYMENT_REQUIRED');
    assert.ok(unpaid.body.details.premiumAdjustment > 0);
    assert.equal(policyRow(policy.policyId).sum_insured, 500000, 'cover unchanged until paid');

    const declined = await endorse(c, policy.policyId, { sumInsured: 700000, paymentToken: 'tok_decline' });
    assert.equal(declined.status, 402);
    assert.equal(declined.body.code, 'PAYMENT_FAILED');
    assert.equal(policyRow(policy.policyId).version, 1, 'declined payment changes nothing');

    const paid = await endorse(c, policy.policyId, { sumInsured: 700000, paymentToken: 'tok_success' });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.policy.sumInsured, 700000);
    assert.ok(paid.body.paymentId);
    assert.ok(paid.body.invoiceDocumentId, 'GST invoice for the extra premium');
    const payment = t.ctx.db.get('SELECT * FROM payments WHERE id = ?', paid.body.paymentId);
    assert.equal(payment.purpose, 'ENDORSEMENT');
    assert.equal(payment.status, 'CAPTURED');
    assert.equal(payment.amount, paid.body.premiumAdjustment);
    assert.equal(paid.body.premiumAdjustment, unpaid.body.details.premiumAdjustment);
  });

  test('TC-Endorse-05: lowering the sum insured refunds the difference; nominee changes cost nothing', async () => {
    const c = await t.newCustomer('end5');
    const { policy } = await t.buyPolicy(c);

    const lower = await endorse(c, policy.policyId, { sumInsured: 400000 });
    assert.equal(lower.status, 200);
    assert.ok(lower.body.premiumAdjustment < 0);
    assert.ok(lower.body.refundId);
    const refund = t.ctx.db.get('SELECT * FROM refunds WHERE id = ?', lower.body.refundId);
    assert.equal(refund.amount, -lower.body.premiumAdjustment);

    const nominee = await endorse(c, policy.policyId, { nominee: 'Asha Rao' });
    assert.equal(nominee.status, 200);
    assert.equal(nominee.body.premiumAdjustment, 0);
    assert.equal(nominee.body.paymentId, undefined);
    assert.equal(nominee.body.refundId, undefined);
  });

  test('TC-Endorse-04: endorsement fields must be real strings and plain numbers (DEF-11)', async () => {
    const c = await t.newCustomer('end4');
    const { policy } = await t.buyPolicy(c);
    for (const body of [
      { nominee: {} },
      { nominee: ['Asha', 'Rao'] },
      { nominee: 12345 },
      { address: { line1: 'x' } },
      { sumInsured: '0x1E8480' },
      { sumInsured: true },
      { sumInsured: [700000] },
      { sumInsured: '7e5' },
    ]) {
      const res = await endorse(c, policy.policyId, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(policyRow(policy.policyId).nominee, null);
    // A plain decimal string (what an HTML number input sends) is still accepted.
    const ok = await endorse(c, policy.policyId, { sumInsured: '700000' });
    assert.equal(ok.body.code, 'PAYMENT_REQUIRED');
  });

  test('TC-Cancel-03: cancelling after an early renewal refunds the unused old period plus the whole new period (DEF-10)', async () => {
    const c = await t.newCustomer('cnl3');
    const { policy } = await t.buyPolicy(c);
    const start = addDays(today(), -320);
    const end1 = addDays(start, 364);
    t.ctx.db.run('UPDATE policies SET start_date = ?, end_date = ? WHERE id = ?', start, end1, policy.policyId);

    const renewed = await t.call('POST', `/policies/${policy.policyId}/renew`, { token: c.token, body: { paymentToken: 'tok_success' } });
    assert.equal(renewed.status, 200);
    const p1 = policy.premium;
    const p2 = renewed.body.policy.premium;

    const res = await t.call('POST', `/policies/${policy.policyId}/cancel`, { token: c.token, body: {} });
    assert.equal(res.status, 200);
    const unusedOld = (p1 * daysBetween(today(), addDays(end1, 1))) / daysBetween(start, addDays(end1, 1));
    const gross = round2(unusedOld + p2);
    assert.equal(res.body.grossRefund, gross);
    assert.equal(res.body.refundAmount, round2(gross - round2(gross * 0.05)));
  });

  test('TC-Cancel-04: cancelling during a renewed period pro-rates that period\'s premium only (DEF-10)', async () => {
    const c = await t.newCustomer('cnl4');
    const { policy } = await t.buyPolicy(c);
    const start = addDays(today(), -320);
    const end1 = addDays(start, 364);
    t.ctx.db.run('UPDATE policies SET start_date = ?, end_date = ? WHERE id = ?', start, end1, policy.policyId);
    const renewed = await t.call('POST', `/policies/${policy.policyId}/renew`, { token: c.token, body: { paymentToken: 'tok_success' } });
    const p2 = renewed.body.policy.premium;

    // Move the whole policy 200 days into the past, so today is inside the renewed year.
    const end2 = addDays(addYears(end1, 1), -200);
    t.ctx.db.run('UPDATE policies SET start_date = ?, end_date = ? WHERE id = ?', addDays(start, -200), end2, policy.policyId);
    const periodStart = addDays(addDays(end1, -200), 1);

    const res = await t.call('POST', `/policies/${policy.policyId}/cancel`, { token: c.token, body: {} });
    assert.equal(res.status, 200);
    const gross = round2((p2 * daysBetween(today(), addDays(end2, 1))) / daysBetween(periodStart, addDays(end2, 1)));
    assert.equal(res.body.grossRefund, gross);
  });

  test('TC-Cancel-05: the unused part of a paid endorsement is refunded on cancellation', async () => {
    const c = await t.newCustomer('cnl5');
    const { policy } = await t.buyPolicy(c);
    const start = addDays(today(), -100);
    const end = addDays(start, 364);
    t.ctx.db.run('UPDATE policies SET start_date = ?, end_date = ? WHERE id = ?', start, end, policy.policyId);

    const up = await endorse(c, policy.policyId, { sumInsured: 700000, paymentToken: 'tok_success' });
    assert.equal(up.status, 200);
    const res = await t.call('POST', `/policies/${policy.policyId}/cancel`, { token: c.token, body: {} });
    const unusedBase = (policy.premium * daysBetween(today(), addDays(end, 1))) / 365;
    // Endorsed today and cancelled today: none of the extra cover was used.
    assert.equal(res.body.grossRefund, round2(unusedBase + up.body.premiumAdjustment));
  });
});

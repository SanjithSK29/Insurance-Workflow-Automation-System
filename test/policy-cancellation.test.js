// IWA-F-014: policy cancellation with a pro-rata refund, a signed cancellation
// letter, audit trail and customer notification.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { addDays, daysBetween, today, round2 } = require('../src/core/util');

describe('Policy cancellation and pro-rata refund', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Cancel-01: cancelling an active policy refunds the unexpired premium', async () => {
    const c = await t.newCustomer('cnl1', { email: 'cnl1@test.local' });
    const { policy } = await t.buyPolicy(c);

    // Pin the cover window so the pro-rata math is deterministic:
    // 200 elapsed days, 165 remaining (total 365).
    const base = today();
    const start = addDays(base, -200);
    const end = addDays(start, 364);
    t.ctx.db.run('UPDATE policies SET start_date = ?, end_date = ? WHERE id = ?', start, end, policy.policyId);

    const res = await t.call('POST', `/policies/${policy.policyId}/cancel`, { token: c.token, body: { reason: 'Moving abroad' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.policy.status, 'CANCELLED');

    const remaining = daysBetween(base, addDays(end, 1));
    assert.equal(res.body.remainingDays, remaining);
    const gross = round2((policy.premium * remaining) / 365);
    const fee = round2(gross * 0.05);
    assert.equal(res.body.grossRefund, gross);
    assert.equal(res.body.fee, fee);
    assert.equal(res.body.refundAmount, round2(gross - fee));
    assert.ok(res.body.refundAmount > 0 && res.body.refundAmount < policy.premium, 'partial pro-rata refund');

    // Refund is recorded against the policy.
    const refund = t.ctx.db.get('SELECT * FROM refunds WHERE policy_id = ?', policy.policyId);
    assert.ok(refund, 'refund row exists');
    assert.equal(refund.amount, res.body.refundAmount);
    assert.equal(refund.status, 'PAID');

    // A signed cancellation letter is generated and downloadable.
    const pdf = await t.call('GET', `/documents/${res.body.documentId}`, { token: c.token });
    assert.equal(pdf.status, 200);
    assert.ok(pdf.headers.get('x-document-signature'));
    assert.ok(pdf.body.toString('latin1').includes('Policy Cancellation Letter'));
    const verify = await t.call('GET', `/documents/${res.body.documentId}/verify`, { token: c.token });
    assert.equal(verify.body.signatureValid, true);

    // Detail endpoint exposes the cancellation and audit trail records it.
    const detail = await t.call('GET', `/policies/${policy.policyId}`, { token: c.token });
    assert.equal(detail.body.status, 'CANCELLED');
    assert.equal(detail.body.cancellation.refund_amount, res.body.refundAmount);
    const audit = await t.call('GET', `/admin/audit?entity=policy&entityId=${policy.policyId}`, { token: t.tokens.ADMIN });
    assert.ok(audit.body.find((a) => a.action === 'POLICY_CANCELLED'));

    // The customer is notified and the dashboard reflects the refund.
    const notes = await t.call('GET', '/notifications', { token: c.token });
    assert.ok(notes.body.find((n) => n.type === 'POLICY_CANCELLED'));
    const dash = await t.call('GET', '/admin/dashboard', { token: t.tokens.ADMIN });
    assert.equal(dash.body.policies.cancelled, 1);
    assert.equal(dash.body.finance.refunded, res.body.refundAmount);

    // The cancellations register report lists the cancelled policy.
    const report = await t.call('GET', '/admin/reports/cancellations?format=csv', { token: t.tokens.ADMIN });
    assert.equal(report.status, 200);
    assert.ok(report.body.toString('latin1').includes(policy.policyNumber));
  });

  test('TC-Cancel-02: cancellation is rejected for non-active, expired or invalid requests', async () => {
    const c = await t.newCustomer('cnl2');
    const { policy } = await t.buyPolicy(c);

    // Cancelling twice: the second attempt finds a non-active policy.
    const first = await t.call('POST', `/policies/${policy.policyId}/cancel`, { token: c.token, body: {} });
    assert.equal(first.status, 200);
    const again = await t.call('POST', `/policies/${policy.policyId}/cancel`, { token: c.token, body: {} });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'NOT_ACTIVE');

    // An already-expired (but still marked active) policy cannot be cancelled.
    const c2 = await t.newCustomer('cnl3');
    const { policy: p2 } = await t.buyPolicy(c2);
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', addDays(today(), -1), p2.policyId);
    const expired = await t.call('POST', `/policies/${p2.policyId}/cancel`, { token: c2.token, body: {} });
    assert.equal(expired.status, 409);
    assert.equal(expired.body.code, 'ALREADY_EXPIRED');

    // Reason is optional but must be sane when provided.
    const c3 = await t.newCustomer('cnl4');
    const { policy: p3 } = await t.buyPolicy(c3);
    const badReason = await t.call('POST', `/policies/${p3.policyId}/cancel`, { token: c3.token, body: { reason: 'x' } });
    assert.equal(badReason.status, 400);

    // Roles outside customer/agent/admin may not cancel.
    const forbidden = await t.call('POST', `/policies/${p3.policyId}/cancel`, { token: t.tokens.ADJUSTER, body: {} });
    assert.equal(forbidden.status, 403);
  });
});

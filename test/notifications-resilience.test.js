// DEF-01: notifyCustomer() must never reject. Claims calls it without awaiting
// (fire-and-forget), so a rejected promise becomes an unhandled rejection and
// Node.js terminates the whole server process.
//
// Realistic trigger: the server restarts without DATA_KEY set, a new random key
// is generated, and customer contact details encrypted under the old key can no
// longer be decrypted (AES-GCM authentication fails).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, pdfDoc } = require('./helpers');
const { today } = require('../src/core/util');

describe('Notification resilience (DEF-01)', () => {
  let t;
  before(async () => { t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } }); });
  after(() => t.close());

  // Re-encrypt the stored email with a different key, as happens after a key change.
  const corruptContact = (customerId) => {
    const stale = 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA';
    t.ctx.db.run('UPDATE customers SET email_enc = ? WHERE id = ?', stale, customerId);
  };

  test('TC-Notify-10: notifyCustomer resolves and still delivers in-app when contact details cannot be decrypted', async () => {
    const c = await t.newCustomer('dr1', { email: 'dr1@test.local' });
    corruptContact(c.customerId);
    await assert.doesNotReject(t.ctx.services.notifications.notifyCustomer(c.customerId, 'TEST_EVENT', 'hello'));
    const rows = t.ctx.db.all("SELECT channel, status FROM notifications WHERE customer_id = ? AND type = 'TEST_EVENT'", c.customerId).map((r) => `${r.channel}:${r.status}`);
    assert.ok(rows.includes('IN_APP:DELIVERED'), 'the customer still sees the message in the app');
    assert.ok(rows.includes('EMAIL:FAILED'), 'the undeliverable email is recorded, not silently dropped');
  });

  test('TC-Notify-11: filing a claim for such a customer succeeds and the server keeps running', async () => {
    const c = await t.newCustomer('dr2', { email: 'dr2@test.local' });
    const { policy } = await t.buyPolicy(c);
    corruptContact(c.customerId);

    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      const res = await t.call('POST', '/claims', {
        token: c.token,
        body: { policyId: policy.policyId, claimType: 'hospitalization', amount: 20000, incidentDate: today(), documents: [pdfDoc()] },
      });
      assert.equal(res.status, 201);
      await new Promise((r) => setTimeout(r, 200)); // let the fire-and-forget notifications finish
      assert.deepEqual(unhandled.map((e) => e.message), [], 'no unhandled promise rejections');
      const health = await t.call('GET', '/health');
      assert.equal(health.status, 200);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('TC-Notify-12: a claim goes through its whole lifecycle even if the notification service throws', async () => {
    const c = await t.newCustomer('dr3');
    const { policy } = await t.buyPolicy(c);
    const notifications = t.ctx.services.notifications;
    const original = notifications.notifyCustomer;
    const errors = [];
    const originalError = t.ctx.logger.error;
    t.ctx.logger.error = (event, data) => errors.push({ event, ...data });
    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    // Simulate both failure styles: a synchronous throw and a rejected promise.
    let calls = 0;
    notifications.notifyCustomer = (...args) => {
      calls++;
      if (calls % 2) throw new Error('notification DB locked');
      return Promise.reject(new Error('notification queue down'));
    };
    try {
      const filed = await t.call('POST', '/claims', {
        token: c.token,
        body: { policyId: policy.policyId, claimType: 'hospitalization', amount: 15000, incidentDate: today(), documents: [pdfDoc()] },
      });
      assert.equal(filed.status, 201);
      const approved = await t.call('POST', `/claims/${filed.body.claimId}/decision`, { token: t.tokens.ADJUSTER, body: { outcome: 'approve' } });
      assert.equal(approved.body.claim.status, 'APPROVED');
      const settled = await t.call('POST', `/claims/${filed.body.claimId}/settle`, { token: t.tokens.ADJUSTER });
      assert.equal(settled.status, 200);
      assert.equal(settled.body.status, 'SETTLED');
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(unhandled, []);
      assert.ok(calls >= 4, 'registered, under review, approved and settled were all attempted');
      assert.ok(errors.filter((e) => e.event === 'claim_notification_failed').length >= 4, 'each failure is logged');
    } finally {
      notifications.notifyCustomer = original;
      t.ctx.logger.error = originalError;
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

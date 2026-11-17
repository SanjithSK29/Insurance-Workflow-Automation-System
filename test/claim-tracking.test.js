// SRS §7.1 use case "Track Claim Status" and IWA-F-024: the claimant can follow
// the claim through every status, and each notification tells them what
// happened, including the amount once it is known.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, pdfDoc } = require('./helpers');
const { today } = require('../src/core/util');

describe('Claim status tracking (F-024)', () => {
  let t;
  before(async () => { t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } }); });
  after(() => t.close());

  async function fileAndSettle(tag, amount) {
    const c = await t.newCustomer(tag, { email: `${tag}@test.local` });
    const { policy } = await t.buyPolicy(c);
    const filed = await t.call('POST', '/claims', {
      token: c.token,
      body: { policyId: policy.policyId, claimType: 'hospitalization', amount, incidentDate: today(), documents: [pdfDoc()] },
    });
    return { c, claimId: filed.body.claimId };
  }
  const settle = async (claimId) => {
    await t.call('POST', `/claims/${claimId}/decision`, { token: t.tokens.ADJUSTER, body: { outcome: 'approve' } });
    await t.call('POST', `/claims/${claimId}/settle`, { token: t.tokens.ADJUSTER });
  };
  const inbox = async (c) => (await t.call('GET', '/notifications', { token: c.token })).body;

  test('TC-Track-01: the claim timeline lists every status change in order', async () => {
    const { c, claimId } = await fileAndSettle('tr1', 40000);
    await settle(claimId);
    const detail = await t.call('GET', `/claims/${claimId}`, { token: c.token });
    assert.equal(detail.body.status, 'SETTLED');
    const statuses = detail.body.timeline.map((e) => e.action).filter((a) => /^CLAIM_(REGISTERED|UNDER_REVIEW|APPROVED|SETTLED)$/.test(a));
    assert.deepEqual([...new Set(statuses)], ['CLAIM_REGISTERED', 'CLAIM_UNDER_REVIEW', 'CLAIM_APPROVED', 'CLAIM_SETTLED']);
    const times = detail.body.timeline.map((e) => e.ts);
    assert.deepEqual(times, [...times].sort(), 'timeline is in chronological order');
  });

  test('TC-Track-02: each status message names the claim, and approval and settlement state the amount', async () => {
    const { c, claimId } = await fileAndSettle('tr2', 40000);
    await settle(claimId);
    const byType = Object.fromEntries((await inbox(c)).filter((n) => n.type.startsWith('CLAIM_')).map((n) => [n.type, n.message]));
    for (const type of ['CLAIM_REGISTERED', 'CLAIM_UNDER_REVIEW', 'CLAIM_APPROVED', 'CLAIM_SETTLED']) {
      assert.ok(byType[type]?.includes(claimId), `${type} names the claim`);
    }
    // 40,000 health claim: (40,000 - 5,000) x 0.9 = 31,500.
    assert.match(byType.CLAIM_APPROVED, /Payable amount: INR 31500/);
    assert.match(byType.CLAIM_SETTLED, /INR 31500 has been paid out/);
  });

  test('TC-Track-03: a rejected claim tells the claimant and points them to support', async () => {
    const { c, claimId } = await fileAndSettle('tr3', 20000);
    await t.call('POST', `/claims/${claimId}/decision`, { token: t.tokens.ADJUSTER, body: { outcome: 'reject', comment: 'Not covered' } });
    const rejected = (await inbox(c)).find((n) => n.type === 'CLAIM_REJECTED');
    assert.ok(rejected);
    assert.match(rejected.message, new RegExp(`${claimId} was not approved\\. Contact support`));
    const detail = await t.call('GET', `/claims/${claimId}`, { token: c.token });
    assert.equal(detail.body.status, 'REJECTED');
    assert.equal(detail.body.settlement, null, 'no settlement on a rejected claim');
  });

  test('TC-Track-04: the adjuster team is told when a claim needs their review', async () => {
    const before = t.ctx.db.get("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'TASK_ASSIGNED'", t.users.ADJUSTER.id).n;
    const { claimId } = await fileAndSettle('tr4', 10000);
    const tasks = t.ctx.db.all("SELECT message FROM notifications WHERE user_id = ? AND type = 'TASK_ASSIGNED'", t.users.ADJUSTER.id);
    assert.equal(tasks.length, before + 1);
    assert.match(tasks.at(-1).message, new RegExp(`New task 'Adjuster review' for claim ${claimId}`));
  });

  test('TC-Track-05: email copies match the in-app messages one for one', async () => {
    const { c, claimId } = await fileAndSettle('tr5', 15000);
    await settle(claimId);
    await new Promise((r) => setTimeout(r, 50)); // email sending is asynchronous
    const rows = t.ctx.db.all("SELECT channel, type FROM notifications WHERE customer_id = ? AND type LIKE 'CLAIM_%'", c.customerId);
    const inApp = rows.filter((r) => r.channel === 'IN_APP').map((r) => r.type).sort();
    const email = rows.filter((r) => r.channel === 'EMAIL').map((r) => r.type).sort();
    assert.deepEqual(email, inApp);
    assert.equal(inApp.length, 4);
  });
});

// Edge cases and access rules for policies, payments and documents
// (IWA-F-010..013, IWA-F-031 for these modules; owner: Samarth).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, pdfDoc } = require('./helpers');
const { addDays, today } = require('../src/core/util');
const { buildPdf } = require('../src/modules/pdf');

describe('Policies, payments and documents: edge cases', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  // An agent onboards a customer and buys a policy for them.
  async function agentPolicy(tag) {
    const agent = t.tokens.AGENT;
    const cust = await t.call('POST', '/customers', {
      token: agent,
      body: { name: `Agent client ${tag}`, dob: '1988-06-01', income: 900000, aadhaar: '234512345678', pan: 'ABCPA1234Z' },
    });
    const q = await t.call('POST', '/quote', { token: agent, body: { customerId: cust.body.id, coverageType: 'health' } });
    const app = await t.call('POST', '/applications', { token: agent, body: { quoteId: q.body.quoteId } });
    const pay = await t.call('POST', '/payments', { token: agent, body: { applicationId: app.body.applicationId, paymentToken: 'tok_success' } });
    assert.equal(pay.status, 201);
    return { customerId: cust.body.id, payment: pay.body, policy: pay.body.policy };
  }

  test('TC-Doc-01: documents are readable only by their owner, the owner\'s agent and staff', async () => {
    const a = await t.newCustomer('doc-a');
    const b = await t.newCustomer('doc-b');
    const { policy } = await t.buyPolicy(a);
    const own = await agentPolicy('doc');

    assert.equal((await t.call('GET', `/documents/${policy.documentId}`, { token: b.token })).status, 403);
    assert.equal((await t.call('GET', `/documents/${policy.documentId}/verify`, { token: b.token })).status, 403);
    assert.equal((await t.call('GET', `/documents/${policy.documentId}`, { token: t.tokens.AGENT })).status, 403, 'not in the agent\'s portfolio');
    assert.equal((await t.call('GET', `/documents/${own.policy.documentId}`, { token: t.tokens.AGENT })).status, 200);
    assert.equal((await t.call('GET', `/documents/${policy.documentId}`, { token: t.tokens.ADJUSTER })).status, 200, 'staff can read');
    assert.equal((await t.call('GET', '/documents/DNOPE', { token: a.token })).status, 404);
    assert.equal((await t.call('GET', '/documents/DNOPE/verify', { token: a.token })).status, 404);
    assert.equal((await t.call('GET', `/documents/${policy.documentId}`)).status, 401);
  });

  test('TC-Doc-02: the signing public key is published and uploaded evidence is reported as unsigned', async () => {
    const c = await t.newCustomer('doc-c');
    const key = await t.call('GET', '/documents/public-key', { token: c.token });
    assert.match(key.body.toString(), /BEGIN PUBLIC KEY/);

    const { policy } = await t.buyPolicy(c);
    const claim = await t.call('POST', '/claims', { token: c.token, body: { policyId: policy.policyId, claimType: 'accident', amount: 1000, incidentDate: today(), documents: [pdfDoc()] } });
    const detail = await t.call('GET', `/claims/${claim.body.claimId}`, { token: c.token });
    const v = await t.call('GET', `/documents/${detail.body.documents[0].id}/verify`, { token: c.token });
    assert.equal(v.body.signed, false);
    assert.equal(v.body.signatureValid, null);
    assert.equal(v.body.integrityValid, true);
  });

  test('TC-Pay-06: payment requests are validated before any charge', async () => {
    const c = await t.newCustomer('pay6');
    assert.equal((await t.call('POST', '/payments', { token: c.token, body: {} })).status, 400);
    assert.equal((await t.call('POST', '/payments', { token: c.token, body: { applicationId: 'ANOPE', paymentToken: 'tok_success' } })).status, 404);

    const bad = await t.newCustomer('pay6b', { pan: 'ABCCK1234Z' }); // company PAN: KYC fails
    const q = await t.call('POST', '/quote', { token: bad.token, body: { customerId: bad.customerId, coverageType: 'health' } });
    const app = await t.call('POST', '/applications', { token: bad.token, body: { quoteId: q.body.quoteId } });
    const res = await t.call('POST', '/payments', { token: bad.token, body: { applicationId: app.body.applicationId, paymentToken: 'tok_success' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NOT_APPROVED');
    assert.equal(t.ctx.db.get('SELECT COUNT(*) AS n FROM payments WHERE reference_id = ?', app.body.applicationId).n, 0, 'nothing charged');

    const q2 = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health' } });
    const ok = await t.call('POST', '/applications', { token: c.token, body: { quoteId: q2.body.quoteId } });
    const unknown = await t.call('POST', '/payments', { token: c.token, body: { applicationId: ok.body.applicationId, paymentToken: 'tok_made_up' } });
    assert.equal(unknown.status, 402);
    assert.match(unknown.body.message, /Unknown payment token/);
    const other = await t.newCustomer('pay6c');
    const notYours = await t.call('POST', '/payments', { token: other.token, body: { applicationId: ok.body.applicationId, paymentToken: 'tok_success' } });
    assert.equal(notYours.status, 403);
  });

  test('TC-Pay-07: payment history is scoped to the customer, the agent\'s portfolio and finance staff', async () => {
    const c = await t.newCustomer('pay7');
    const { payment } = await t.buyPolicy(c);
    const agentSide = await agentPolicy('pay7');

    const mine = await t.call('GET', '/payments', { token: c.token });
    assert.deepEqual(mine.body.map((p) => p.paymentId), [payment.paymentId]);
    const agent = await t.call('GET', '/payments', { token: t.tokens.AGENT });
    assert.ok(agent.body.some((p) => p.paymentId === agentSide.payment.paymentId), 'agent sees portfolio payments');
    assert.ok(!agent.body.some((p) => p.paymentId === payment.paymentId), 'but not other customers\' payments');
    const admin = await t.call('GET', '/payments', { token: t.tokens.ADMIN });
    assert.ok(admin.body.length >= 2);
    assert.deepEqual((await t.call('GET', '/payments', { token: t.tokens.ADJUSTER })).body, []);
  });

  test('TC-Pay-08: refunds and payouts reject invalid amounts', async () => {
    const p = t.ctx.services.payments;
    await assert.rejects(p.refund({ policyId: 'P1', amount: -5, reason: 'x', actorId: 'u' }), /Invalid refund amount/);
    await assert.rejects(p.refund({ policyId: 'P1', amount: NaN, reason: 'x', actorId: 'u' }), /Invalid refund amount/);
    await assert.rejects(p.payout({ claimId: 'C1', amount: -1, actorId: 'u' }), /Invalid payout amount/);
    await assert.rejects(p.gateway.charge({ amount: 0, token: 'tok_success', idempotencyKey: 'k' }), /Invalid amount/);
  });

  test('TC-Renew-04: renewal is refused for cancelled, lapsed, too-old or unpaid requests', async () => {
    const c = await t.newCustomer('ren-x');
    const { policy } = await t.buyPolicy(c);
    const renew = (body = { paymentToken: 'tok_success' }) => t.call('POST', `/policies/${policy.policyId}/renew`, { token: c.token, body });

    assert.equal((await renew({})).status, 400, 'paymentToken required');

    t.ctx.db.run("UPDATE policies SET end_date = ?, status = 'EXPIRED' WHERE id = ?", addDays(today(), -40), policy.policyId);
    const lapsed = await renew();
    assert.equal(lapsed.body.code, 'LAPSED');

    t.ctx.db.run("UPDATE policies SET end_date = ?, status = 'ACTIVE' WHERE id = ?", addDays(today(), 10), policy.policyId);
    t.ctx.db.run("UPDATE customers SET dob = '1950-01-01' WHERE id = ?", c.customerId);
    const tooOld = await renew();
    assert.equal(tooOld.status, 422);
    assert.equal(tooOld.body.code, 'NOT_RENEWABLE');
    assert.equal((await t.call('GET', `/policies/${policy.policyId}/renewal-quote`, { token: c.token })).status, 422);

    t.ctx.db.run("UPDATE policies SET status = 'CANCELLED' WHERE id = ?", policy.policyId);
    const cancelled = await renew();
    assert.equal(cancelled.status, 409);
    assert.equal(cancelled.body.code, 'NOT_RENEWABLE');
    assert.equal(t.ctx.db.get("SELECT COUNT(*) AS n FROM payments WHERE policy_id = ? AND purpose = 'RENEWAL'", policy.policyId).n, 0, 'nothing charged');
  });

  test('TC-Renew-03: the reminder job marks policies past their end date as expired', async () => {
    const c = await t.newCustomer('ren-exp');
    const { policy } = await t.buyPolicy(c);
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', addDays(today(), -1), policy.policyId);
    await t.call('POST', '/admin/jobs/renewal-reminders', { token: t.tokens.ADMIN, body: {} });
    assert.equal(t.ctx.db.get('SELECT status FROM policies WHERE id = ?', policy.policyId).status, 'EXPIRED');
  });

  test('TC-Endorse-06: endorsement limits and states', async () => {
    const c = await t.newCustomer('end6');
    const { policy } = await t.buyPolicy(c);
    const endorse = (body) => t.call('POST', `/policies/${policy.policyId}/endorse`, { token: c.token, body });
    for (const [body, why] of [
      [{}, 'nothing to change'],
      [{ nominee: '' }, 'empty value is ignored, leaving nothing to change'],
      [{ premium: 1 }, 'not endorsable'],
      [{ nominee: 'A' }, 'nominee too short'],
      [{ address: 'abc' }, 'address too short'],
      [{ sumInsured: 10000 }, 'below 50,000'],
      [{ sumInsured: 50_000_000 }, 'above the income limit'],
    ]) {
      assert.equal((await endorse(body)).status, 400, why);
    }
    assert.equal((await t.call('POST', `/policies/${policy.policyId}/endorse`, { token: t.tokens.UNDERWRITER, body: { nominee: 'Some One' } })).status, 403);
    t.ctx.db.run("UPDATE policies SET status = 'CANCELLED' WHERE id = ?", policy.policyId);
    const res = await endorse({ nominee: 'Asha Rao' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NOT_ACTIVE');
  });

  test('TC-Policy-04: policy lists are scoped by role and policies can be looked up by number', async () => {
    const c = await t.newCustomer('pol4');
    const { policy } = await t.buyPolicy(c);
    const agentSide = await agentPolicy('pol4');

    const mine = await t.call('GET', '/policies', { token: c.token });
    assert.deepEqual(mine.body.map((p) => p.policyId), [policy.policyId]);
    const agent = await t.call('GET', '/policies', { token: t.tokens.AGENT });
    assert.ok(agent.body.some((p) => p.policyId === agentSide.policy.policyId));
    assert.ok(!agent.body.some((p) => p.policyId === policy.policyId));
    const admin = await t.call('GET', '/policies', { token: t.tokens.ADMIN });
    assert.ok(admin.body.some((p) => p.policyId === policy.policyId));

    const byNumber = await t.call('GET', `/policies/${policy.policyNumber}`, { token: c.token });
    assert.equal(byNumber.body.policyId, policy.policyId);
    assert.ok(byNumber.body.documents.some((d) => d.kind === 'INVOICE'), 'invoice listed with the policy');
    assert.equal((await t.call('GET', '/policies/PNOPE', { token: c.token })).status, 404);
  });

  test('TC-PDF-05: the PDF writer wraps unbroken text and breaks pages inside wrapped lines', () => {
    const empty = buildPdf({}).toString('latin1');
    assert.match(empty, /\/Count 1 /);
    const longWord = 'X'.repeat(500);
    const text = buildPdf({ lines: Array.from({ length: 52 }, () => 'line').concat([longWord]) }).toString('latin1');
    assert.match(text, /\/Count 2 /, 'wrapped line continues on a new page');
    assert.ok(!text.includes(longWord), 'unbroken text is split');
  });
});

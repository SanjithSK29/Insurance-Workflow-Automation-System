// IWA-F-001 Quote generation, IWA-F-002 risk scoring, IWA-F-003 KYC.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { calculatePremium } = require('../src/modules/quotes');
const { scoreRisk } = require('../src/modules/underwriting');

describe('Quote generation (IWA-F-001)', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Quote-01: quote returned with premium breakdown within 10 seconds', async () => {
    const started = Date.now();
    const res = await t.call('POST', '/quote', { body: { age: 30, income: 800000, coverageType: 'health', term: 1 } });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 201);
    assert.match(res.body.quoteId, /^Q[0-9A-F]{10}$/);
    assert.ok(res.body.premium > 0);
    assert.match(res.body.validUntil, /^\d{4}-\d{2}-\d{2}$/);
    const b = res.body.breakdown;
    for (const k of ['basePremium', 'ageLoading', 'termDiscount', 'netPremium', 'gst', 'total']) assert.ok(k in b, `breakdown.${k}`);
    assert.equal(b.total, res.body.premium);
    assert.ok(Math.abs(b.netPremium * 0.18 - b.gst) < 0.02, 'GST is 18% of net premium');
    assert.ok(elapsed < 10_000, `took ${elapsed}ms`);
  });

  test('TC-Quote-02: invalid input is rejected with 400 and the error envelope', async () => {
    for (const body of [
      { age: 30, income: 800000, coverageType: 'pet', term: 1 },
      { age: 12, income: 800000, coverageType: 'health', term: 1 },
      { age: 30, income: -5, coverageType: 'health', term: 1 },
      { age: 30, income: 800000, coverageType: 'health', term: 9 },
      { age: 'thirty', income: 800000, coverageType: 'life' },
    ]) {
      const res = await t.call('POST', '/quote', { body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'INVALID_INPUT');
      assert.ok(res.body.traceId);
      assert.ok(res.body.message);
    }
  });

  test('premium is personalized by age, smoking and term', () => {
    const base = { coverageType: 'health', income: 800000, term: 1, sumInsured: 500000 };
    const young = calculatePremium({ ...base, age: 28 }).premium;
    const older = calculatePremium({ ...base, age: 58 }).premium;
    const smoker = calculatePremium({ ...base, age: 28, smoker: true }).premium;
    const threeYear = calculatePremium({ ...base, age: 28, term: 3 });
    assert.ok(older > young);
    assert.ok(smoker > young);
    assert.ok(threeYear.breakdown.termDiscount < 0, 'multi-year discount applied');
    assert.ok(threeYear.premium < young * 3);
  });

  test('actuarial outage returns 503', async () => {
    t.ctx.services.quotes.actuarial.outage = true;
    const res = await t.call('POST', '/quote', { body: { age: 30, income: 800000, coverageType: 'health', term: 1 } });
    t.ctx.services.quotes.actuarial.outage = false;
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'SERVICE_UNAVAILABLE');
  });
});

describe('Underwriting and KYC (IWA-F-002, IWA-F-003)', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-UW-01: risk score is bounded 0-100 and rules fire', () => {
    const low = scoreRisk({ age: 30, coverageType: 'health', sumInsured: 500000, income: 1000000 });
    assert.equal(low.score, 0);
    const extreme = scoreRisk({ age: 60, coverageType: 'life', sumInsured: 50_000_000, income: 100_000, smoker: true, conditions: ['a', 'b', 'c', 'd'], occupation: 'Offshore diver', previousClaims: 9 });
    assert.equal(extreme.score, 100);
    assert.ok(extreme.flags.map((f) => f.code).includes('SMOKER'));
  });

  test('TC-UW-01: low-risk applications auto-approve, high-risk go to manual review per threshold', async () => {
    const c = await t.newCustomer('uw1');
    const quote = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health', sumInsured: 500000 } });
    const low = await t.call('POST', '/applications', { token: c.token, body: { quoteId: quote.body.quoteId, declarations: {} } });
    assert.equal(low.status, 201);
    assert.equal(low.body.status, 'APPROVED');
    assert.equal(low.body.threshold, 60);

    const q2 = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health', sumInsured: 500000, smoker: true } });
    const high = await t.call('POST', '/applications', {
      token: c.token,
      body: { quoteId: q2.body.quoteId, declarations: { smoker: true, conditions: ['diabetes', 'asthma', 'hypertension'], occupation: 'Mining engineer' } },
    });
    assert.equal(high.body.status, 'MANUAL_REVIEW');
    assert.ok(high.body.riskScore >= 60);

    const queue = await t.call('GET', '/applications?status=MANUAL_REVIEW', { token: t.tokens.UNDERWRITER });
    assert.ok(queue.body.some((a) => a.applicationId === high.body.applicationId));
    const decision = await t.call('POST', `/applications/${high.body.applicationId}/decision`, { token: t.tokens.UNDERWRITER, body: { decision: 'APPROVE', note: 'Medical reports reviewed' } });
    assert.equal(decision.body.status, 'APPROVED');
    assert.equal(decision.body.decidedBy, t.users.UNDERWRITER.id);
  });

  test('threshold is configurable by admin', async () => {
    const res = await t.call('PUT', '/admin/settings/risk-threshold', { token: t.tokens.ADMIN, body: { value: 10 } });
    assert.equal(res.body.riskThreshold, 10);
    const c = await t.newCustomer('uw2', { dob: '1975-03-01' }); // age 51 -> AGE_ELEVATED (10)
    const q = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health', sumInsured: 500000 } });
    const app = await t.call('POST', '/applications', { token: c.token, body: { quoteId: q.body.quoteId } });
    assert.equal(app.body.status, 'MANUAL_REVIEW');
    await t.call('PUT', '/admin/settings/risk-threshold', { token: t.tokens.ADMIN, body: { value: 60 } });
  });

  test('TC-KYC-01: KYC pass and fail results are returned before issuance', async () => {
    const ok = await t.newCustomer('kyc1');
    const pass = await t.call('POST', `/customers/${ok.customerId}/kyc`, { token: ok.token });
    assert.equal(pass.body.status, 'VERIFIED');
    assert.ok(pass.body.reference);

    const bad = await t.newCustomer('kyc2', { pan: 'ABCCK1234Z' }); // 4th char C = company PAN
    const fail = await t.call('POST', `/customers/${bad.customerId}/kyc`, { token: bad.token });
    assert.equal(fail.body.status, 'FAILED');

    const q = await t.call('POST', '/quote', { token: bad.token, body: { customerId: bad.customerId, coverageType: 'health' } });
    const app = await t.call('POST', '/applications', { token: bad.token, body: { quoteId: q.body.quoteId } });
    assert.equal(app.body.status, 'KYC_FAILED');
    const pay = await t.call('POST', '/payments', { token: bad.token, body: { applicationId: app.body.applicationId, paymentToken: 'tok_success' } });
    assert.equal(pay.status, 409, 'no policy without KYC');
  });

  test('KYC provider outage routes to manual queue, underwriter resolves it, application resumes', async () => {
    t.ctx.services.customers.kycProvider.outage = true;
    const c = await t.newCustomer('kyc3');
    const q = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health' } });
    const app = await t.call('POST', '/applications', { token: c.token, body: { quoteId: q.body.quoteId } });
    t.ctx.services.customers.kycProvider.outage = false;
    assert.equal(app.body.status, 'PENDING_KYC');

    const resolve = await t.call('POST', `/customers/${c.customerId}/kyc/manual`, { token: t.tokens.UNDERWRITER, body: { decision: 'VERIFIED' } });
    assert.equal(resolve.status, 200);
    const after = await t.call('GET', `/applications/${app.body.applicationId}`, { token: c.token });
    assert.equal(after.body.status, 'APPROVED');
  });

  test('expired or reused quotes cannot be applied', async () => {
    const c = await t.newCustomer('q-reuse');
    const q = await t.call('POST', '/quote', { token: c.token, body: { customerId: c.customerId, coverageType: 'health' } });
    await t.call('POST', '/applications', { token: c.token, body: { quoteId: q.body.quoteId } });
    const again = await t.call('POST', '/applications', { token: c.token, body: { quoteId: q.body.quoteId } });
    assert.equal(again.status, 409);
  });
});

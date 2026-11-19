const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, pdfDoc } = require('./helpers');
const { detectFraud } = require('../src/modules/fraud');
const { addDays, today } = require('../src/core/util');

describe('Sprint 4 Security, Fraud Detection & Claims Export', () => {
  let env;

  before(async () => {
    env = await startApp();
  });

  after(async () => {
    await env.close();
  });

  it('TC-Cust-03: Customer can update emergency contact details with validation and audit', async () => {
    const cust = await env.newCustomer('emergency-01');

    // Invalid phone
    const resBadPhone = await env.call('PATCH', `/customers/${cust.customerId}/emergency-contact`, {
      token: cust.token,
      body: { name: 'Parent One', phone: '12345', relation: 'parent' },
    });
    assert.equal(resBadPhone.status, 400);

    // Valid update
    const resOk = await env.call('PATCH', `/customers/${cust.customerId}/emergency-contact`, {
      token: cust.token,
      body: { name: 'Jane Doe', phone: '9876543210', relation: 'spouse' },
    });
    assert.equal(resOk.status, 200);
    assert.ok(resOk.body.emergencyContact);
    assert.equal(resOk.body.emergencyContact.name, 'Jane Doe');
    assert.equal(resOk.body.emergencyContact.phone, '9876543210');
    assert.equal(resOk.body.emergencyContact.relation, 'spouse');

    // Check audit trail
    const auditRow = env.ctx.db.get("SELECT * FROM audit_log WHERE entity_id = ? AND action = 'CUSTOMER_EMERGENCY_CONTACT_UPDATED'", cust.customerId);
    assert.ok(auditRow);
  });

  it('TC-Fraud-12: RAPID_INCEPTION_HIGH_VALUE rule triggers when high claim occurs within 14 days of inception', () => {
    const policy = {
      start_date: '2026-01-01',
      sum_insured: 500_000,
    };
    const claim = {
      claimType: 'hospitalization',
      amount: 300_000, // 60% of sum insured (>50%)
      incidentDate: '2026-01-08', // 7 days after start (<= 14)
    };
    const result = detectFraud({
      claim,
      policy,
      priorClaims: [],
      documentsCount: 1,
      reportedOn: '2026-01-09',
      remainingCover: 500_000,
    });

    const rapidFlag = result.flags.find((f) => f.code === 'RAPID_INCEPTION_HIGH_VALUE');
    assert.ok(rapidFlag, 'RAPID_INCEPTION_HIGH_VALUE flag should be present');
    assert.equal(rapidFlag.points, 35);
    assert.ok(result.score >= 50, 'Fraud score should exceed threshold');
    assert.equal(result.flagged, true);
  });

  it('TC-Report-02: Adjuster can export claims register CSV with filtering; Customer is forbidden', async () => {
    const cust = await env.newCustomer('report-01');
    const { policy: pol } = await env.buyPolicy(cust, { coverageType: 'health', sumInsured: 500_000, term: 1 });

    // File a claim
    await env.call('POST', '/claims', {
      token: cust.token,
      body: {
        policyId: pol.policyId,
        claimType: 'hospitalization',
        amount: 25_000,
        incidentDate: today(),
        description: 'Routine minor admission',
        documents: [pdfDoc()],
      },
    });

    // Customer attempt should return 403 Forbidden
    const custExport = await env.call('GET', '/admin/reports/claims?format=csv', { token: cust.token });
    assert.equal(custExport.status, 403);

    // Adjuster attempt should succeed
    const adjExport = await env.call('GET', '/admin/reports/claims?format=csv&coverageType=health', { token: env.tokens.ADJUSTER });
    assert.equal(adjExport.status, 200);
    assert.ok(adjExport.headers.get('content-type').includes('text/csv'));
    const csvContent = Buffer.isBuffer(adjExport.body) ? adjExport.body.toString('utf8') : String(adjExport.body);
    assert.ok(csvContent.includes('claim_id'));
    assert.ok(csvContent.includes('hospitalization'));
  });

  it('TC-Sec-XSS-01: claim text is stored exactly as written and returned only as JSON data (DEF-16)', async () => {
    const cust = await env.newCustomer('xss-01');
    const { policy: pol } = await env.buyPolicy(cust, { coverageType: 'motor', sumInsured: 200_000, term: 1 });
    const description = '<img src=x onerror=alert(1)>Bumper replaced; bill < 15000, estimate > 12000';

    const res = await env.call('POST', '/claims', {
      token: cust.token,
      body: { policyId: pol.policyId, claimType: 'accident', amount: 15_000, incidentDate: today(), description, documents: [pdfDoc()] },
    });
    assert.equal(res.status, 201);

    // Nothing is silently deleted from what the customer wrote.
    const claimRow = env.ctx.db.get('SELECT description FROM claims WHERE id = ?', res.body.claimId);
    assert.equal(claimRow.description, description);

    // It is served as JSON data, never as HTML; the web UI renders it as text (TC-Sec-XSS-02).
    const view = await env.call('GET', `/claims/${res.body.claimId}`, { token: cust.token });
    assert.match(view.headers.get('content-type'), /^application\/json/);
    assert.equal(view.body.description, description);
    assert.equal(view.headers.get('x-content-type-options'), 'nosniff');
  });
});

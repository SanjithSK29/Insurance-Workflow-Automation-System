// DEF-02: isIsoDate() must reject calendar dates that do not exist.
// JavaScript's Date silently rolls 2026-02-30 over to 2026-03-02, so a regex
// plus "is it NaN?" check lets impossible dates through. They are used for the
// claim incident date (IWA-F-020) and the customer's date of birth (KYC).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { isIsoDate } = require('../src/core/util');
const { startApp, pdfDoc } = require('./helpers');

describe('Date validation (DEF-02)', () => {
  test('TC-Date-01: real dates are accepted, including 29 February in a leap year', () => {
    for (const d of ['2026-01-01', '2026-12-31', '2024-02-29', '2000-02-29', '2026-04-30']) assert.equal(isIsoDate(d), true, d);
  });

  test('TC-Date-02: impossible dates are rejected instead of rolling over to the next month', () => {
    for (const d of ['2026-02-30', '2026-02-31', '2026-04-31', '2026-06-31', '2025-02-29', '1900-02-29']) assert.equal(isIsoDate(d), false, d);
  });

  test('TC-Date-03: wrong formats and types are rejected', () => {
    for (const d of ['2026-13-01', '2026-00-10', '2026-1-5', '17-11-2026', '2026/11/17', '', null, undefined, 20261117, '2026-11-17T00:00:00Z']) {
      assert.equal(isIsoDate(d), false, String(d));
    }
  });

  describe('through the claims API', () => {
    let t;
    before(async () => { t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } }); });
    after(() => t.close());

    test('TC-Claim-11: a claim with incident date 30 February is refused with 422', async () => {
      const c = await t.newCustomer('dt1');
      const { policy } = await t.buyPolicy(c);
      // Move the policy window so 2026-02-30 would otherwise fall inside it.
      t.ctx.db.run("UPDATE policies SET start_date = '2026-01-01' WHERE id = ?", policy.policyId);
      const res = await t.call('POST', '/claims', {
        token: c.token,
        body: { policyId: policy.policyId, claimType: 'hospitalization', amount: 1000, incidentDate: '2026-02-30', documents: [pdfDoc()] },
      });
      assert.equal(res.status, 422);
      assert.match(res.body.message, /incidentDate must be YYYY-MM-DD/);
    });
  });
});

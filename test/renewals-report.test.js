// Admin "Renewals Due" report (IWA-F-033) and renewal-pipeline dashboard metrics.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { addDays, today } = require('../src/core/util');

describe('Renewals due report and renewal pipeline metrics', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Renewal-Report-01: renewals report lists active policies by soonest expiry with days-to-expiry', async () => {
    const c = await t.newCustomer('renexp');
    const { policy } = await t.buyPolicy(c);

    // A second policy expiring sooner must sort first.
    const c2 = await t.newCustomer('renexp2');
    const { policy: policy2 } = await t.buyPolicy(c2, { sumInsured: 600_000 });
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', addDays(today(), 5), policy2.policyId);
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', addDays(today(), 30), policy.policyId);

    const csv = await t.call('GET', '/admin/reports/renewals?format=csv', { token: t.tokens.ADMIN });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);

    const lines = csv.body.toString('utf8').trim().split('\r\n');
    assert.equal(lines[0], 'policy_number,customer,coverage_type,premium,end_date,days_to_expiry');

    const data = lines.slice(1);
    assert.equal(data.length, 2);
    const byNumber = Object.fromEntries(data.map((l) => [l.split(',')[0], l.split(',')]));
    assert.equal(byNumber[policy.policyNumber].pop(), '30');
    assert.equal(byNumber[policy2.policyNumber].pop(), '5');
    // Soonest expiry is listed first.
    assert.ok(data[0].startsWith(policy2.policyNumber));
  });

  test('TC-Renewal-Report-02: renewals report renders as PDF and is admin-only', async () => {
    const pdf = await t.call('GET', '/admin/reports/renewals?format=pdf', { token: t.tokens.ADMIN });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');

    const denied = await t.call('GET', '/admin/reports/renewals?format=csv', { token: t.tokens.CUSTOMER });
    assert.equal(denied.status, 403);
  });

  test('TC-Renewal-Report-03: dashboard exposes the renewal pipeline (overdue and window-open)', async () => {
    const c = await t.newCustomer('rendash');
    const { policy } = await t.buyPolicy(c);

    // One policy past its end_date (the daily expiry job has not run yet).
    t.ctx.db.run('UPDATE policies SET end_date = ? WHERE id = ?', addDays(today(), -3), policy.policyId);

    const dash = await t.call('GET', '/admin/dashboard', { token: t.tokens.ADMIN });
    assert.equal(dash.status, 200);
    assert.ok(dash.body.renewals.overdue >= 1, 'overdue active policies are surfaced');
    assert.ok(Number.isInteger(dash.body.renewals.renewalWindowOpen));
  });
});

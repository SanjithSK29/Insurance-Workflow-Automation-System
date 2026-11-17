// Numeric inputs from JSON bodies (DEF-03..07). Number() coerces true to 1,
// [5] to 5, "" to 0 and "0x10" to 16, so range checks alone let these through.
// parseNumber() accepts only finite numbers and plain decimal strings.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { parseNumber } = require('../src/core/util');
const { startApp } = require('./helpers');

describe('parseNumber (shared numeric input rule)', () => {
  test('TC-Num-01: numbers and plain decimal strings are accepted', () => {
    const cases = [[5, 5], [0, 0], [-3, -3], [1500.5, 1500.5], ['5', 5], [' 7 ', 7], ['-3', -3], ['1500.50', 1500.5], ['0', 0]];
    for (const [input, expected] of cases) assert.equal(parseNumber(input), expected, JSON.stringify(input));
  });

  test('TC-Num-02: values that only become numbers through coercion are rejected', () => {
    for (const input of [true, false, [5], [], {}, null, undefined, '', ' ', '0x10', '1e5', 'NaN', 'Infinity', '5abc', '1,500', Infinity, NaN]) {
      assert.ok(Number.isNaN(parseNumber(input)), String(input));
    }
  });
});

describe('Numeric inputs through the API', () => {
  let t;
  before(async () => { t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } }); });
  after(() => t.close());

  const quote = (body) => t.call('POST', '/quote', { body: { age: 30, income: 800000, coverageType: 'health', term: 1, ...body } });

  test('TC-Quote-06: quote fields refuse coerced values (DEF-04)', async () => {
    for (const body of [{ age: [30] }, { age: true }, { income: '0x10000' }, { income: true }, { term: true }, { term: [2] }, { sumInsured: [100000] }, { sumInsured: '1e6' }]) {
      const res = await quote(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'INVALID_INPUT');
    }
  });

  test('TC-Quote-07: numbers and numeric strings still produce the same quote', async () => {
    const asNumbers = await quote({ age: 30, income: 800000, term: 2, sumInsured: 600000 });
    const asStrings = await quote({ age: '30', income: '800000', term: '2', sumInsured: '600000' });
    assert.equal(asNumbers.status, 201);
    assert.equal(asStrings.status, 201);
    assert.equal(asStrings.body.premium, asNumbers.body.premium);
    assert.equal((await quote({ sumInsured: '' })).status, 201, 'blank sum insured still means "use the default"');
  });

  const profile = { name: 'Num Test', dob: '1990-01-15', phone: '9876501234', aadhaar: '234512341234', pan: 'ABCPK1234Z' };
  async function registered(tag) {
    const email = `${tag}@test.local`;
    await t.call('POST', '/auth/register', { body: { email, name: 'Num Test', password: 'Test@12345' } });
    return t.login(email);
  }

  test('TC-KYC-03: customer income refuses true, blank and other coerced values (DEF-05)', async () => {
    const token = await registered('num-c1');
    for (const income of [true, '', ' ', [500000], '0x10000', null]) {
      const res = await t.call('POST', '/customers', { token, body: { ...profile, income } });
      assert.equal(res.status, 400, `income ${JSON.stringify(income)}`);
      assert.match(res.body.message, /income must be a non-negative number/);
    }
    const ok = await t.call('POST', '/customers', { token, body: { ...profile, income: '750000' } });
    assert.equal(ok.status, 201);
    const zero = await t.call('POST', '/customers', { token: await registered('num-c2'), body: { ...profile, income: 0 } });
    assert.equal(zero.status, 201, 'an actual 0 (e.g. a student) is still allowed');
  });

  test('TC-KYC-04: a profile update keeps the old income when none is sent and refuses a coerced one', async () => {
    const c = await t.newCustomer('num-c3');
    const bad = await t.call('PATCH', `/customers/${c.customerId}`, { token: c.token, body: { income: true } });
    assert.equal(bad.status, 400);
    const rename = await t.call('PATCH', `/customers/${c.customerId}`, { token: c.token, body: { name: 'Renamed Person' } });
    assert.equal(rename.status, 200);
    assert.equal(t.ctx.db.get('SELECT income FROM customers WHERE id = ?', c.customerId).income, 1_000_000);
  });

  test('TC-Endorse-02: a coerced sum insured cannot lower cover or trigger a refund (DEF-06)', async () => {
    const c = await t.newCustomer('num-e1');
    const { policy } = await t.buyPolicy(c);
    for (const sumInsured of ['0x10000', [700000], true]) {
      const res = await t.call('POST', `/policies/${policy.policyId}/endorse`, { token: c.token, body: { sumInsured } });
      assert.equal(res.status, 400, `sumInsured ${JSON.stringify(sumInsured)}`);
    }
    const row = t.ctx.db.get('SELECT sum_insured FROM policies WHERE id = ?', policy.policyId);
    assert.equal(row.sum_insured, 500000, 'cover unchanged');
    assert.equal(t.ctx.db.get('SELECT COUNT(*) AS n FROM endorsements WHERE policy_id = ?', policy.policyId).n, 0, 'no endorsement recorded');
    const ok = await t.call('POST', `/policies/${policy.policyId}/endorse`, { token: c.token, body: { sumInsured: '600000', paymentToken: 'tok_success' } }); // raises are paid for (DEF-09)
    assert.equal(ok.status, 200);
    assert.equal(ok.body.policy.sumInsured, 600000);
    assert.ok(ok.body.premiumAdjustment > 0, 'raising cover charges extra premium');
  });

  test('TC-Admin-02: the risk threshold refuses true, blank and arrays (DEF-07)', async () => {
    const set = (value) => t.call('PUT', '/admin/settings/risk-threshold', { token: t.tokens.ADMIN, body: { value } });
    const before = t.ctx.services.underwriting.riskThreshold();
    for (const value of [true, false, '', [70], '0x40', null]) {
      const res = await set(value);
      assert.equal(res.status, 400, `value ${JSON.stringify(value)}`);
    }
    assert.equal(t.ctx.services.underwriting.riskThreshold(), before, 'threshold unchanged');
    const ok = await set('70');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.riskThreshold, 70);
    await set(before); // restore for other tests in this file
  });
});

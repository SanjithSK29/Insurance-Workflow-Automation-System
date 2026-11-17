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
});

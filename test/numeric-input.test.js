// Numeric inputs from JSON bodies (DEF-03..07). Number() coerces true to 1,
// [5] to 5, "" to 0 and "0x10" to 16, so range checks alone let these through.
// parseNumber() accepts only finite numbers and plain decimal strings.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseNumber } = require('../src/core/util');

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

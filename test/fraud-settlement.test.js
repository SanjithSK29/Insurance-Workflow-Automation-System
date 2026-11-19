// Unit tests for the fraud rules (IWA-F-022) and the settlement formula
// (IWA-F-023). Both modules are pure functions, so every rule and boundary is
// checked directly without starting the app.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { detectFraud, FLAG_THRESHOLD } = require('../src/modules/fraud');
const { computeSettlement, POLICY_TERMS } = require('../src/modules/settlement');
const { addDays } = require('../src/core/util');

const REPORTED = '2026-06-30';
const POLICY = { id: 'P1', sum_insured: 500000, start_date: '2026-01-01' };

// A claim that fires no rule: mid-policy, small, reported same day, with documents.
const base = (overrides = {}) => ({
  claim: { claimType: 'hospitalization', amount: 20000, incidentDate: REPORTED },
  policy: POLICY,
  priorClaims: [],
  documentsCount: 1,
  reportedOn: REPORTED,
  remainingCover: 500000,
  ...overrides,
});

const prior = (overrides = {}) => ({
  id: 'C-OLD', claim_type: 'hospitalization', incident_date: REPORTED, status: 'SETTLED', created_at: `${REPORTED}T10:00:00.000Z`, ...overrides,
});

const codes = (r) => r.flags.map((f) => f.code).sort();

describe('Fraud detection rules (IWA-F-022)', () => {
  test('TC-Fraud-02: a clean claim fires no rule and is not flagged', () => {
    const r = detectFraud(base());
    assert.deepEqual(r.flags, []);
    assert.equal(r.score, 0);
    assert.equal(r.flagged, false);
  });

  test('TC-Fraud-03: DUPLICATE_CLAIM fires for the same type within 7 days, in either direction', () => {
    for (const offset of [0, 7, -7]) {
      const r = detectFraud(base({ priorClaims: [prior({ incident_date: addDays(REPORTED, offset), created_at: '2026-01-01T00:00:00Z' })] }));
      assert.deepEqual(codes(r), ['DUPLICATE_CLAIM'], `offset ${offset}`);
      assert.equal(r.score, 60);
      assert.equal(r.flagged, true);
      assert.match(r.flags[0].message, /C-OLD/);
    }
  });

  test('TC-Fraud-04: no duplicate at 8 days apart, for a different claim type, or against a rejected claim', () => {
    const old = { created_at: '2026-01-01T00:00:00Z' };
    assert.deepEqual(codes(detectFraud(base({ priorClaims: [prior({ ...old, incident_date: addDays(REPORTED, -8) })] }))), []);
    assert.deepEqual(codes(detectFraud(base({ priorClaims: [prior({ ...old, claim_type: 'accident' })] }))), []);
    assert.deepEqual(codes(detectFraud(base({ priorClaims: [prior({ ...old, status: 'REJECTED' })] }))), []);
  });

  test('TC-Fraud-05: EXCEEDS_REMAINING_COVER fires above the remaining cover and replaces HIGH_VALUE_RATIO', () => {
    const r = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 450001, incidentDate: REPORTED }, remainingCover: 450000 }));
    assert.deepEqual(codes(r), ['EXCEEDS_REMAINING_COVER']);
    assert.equal(r.score, 30);
    assert.equal(r.flagged, false, '30 points is below the threshold');
    // Exactly equal to the remaining cover is allowed.
    const equal = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 300000, incidentDate: REPORTED }, remainingCover: 300000 }));
    assert.ok(!codes(equal).includes('EXCEEDS_REMAINING_COVER'));
  });

  test('TC-Fraud-06: HIGH_VALUE_RATIO fires only above 80% of the sum insured', () => {
    const at80 = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 400000, incidentDate: REPORTED } }));
    assert.deepEqual(codes(at80), []);
    const over80 = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 400001, incidentDate: REPORTED } }));
    assert.deepEqual(codes(over80), ['HIGH_VALUE_RATIO']);
    assert.equal(over80.score, 20);
  });

  test('TC-Fraud-07: EARLY_CLAIM fires for incidents up to 30 days after policy start', () => {
    const day30 = addDays(POLICY.start_date, 30);
    const day31 = addDays(POLICY.start_date, 31);
    const early = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 20000, incidentDate: day30 }, reportedOn: day30 }));
    assert.deepEqual(codes(early), ['EARLY_CLAIM']);
    assert.equal(early.score, 25);
    const notEarly = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 20000, incidentDate: day31 }, reportedOn: day31 }));
    assert.deepEqual(codes(notEarly), []);
  });

  test('TC-Fraud-08: FREQUENT_CLAIMS fires for 2 or more non-rejected claims in the last 90 days', () => {
    const recent = (id, daysAgo, status = 'SETTLED') => prior({
      id, claim_type: 'accident', incident_date: '2026-02-01', status, created_at: `${addDays(REPORTED, -daysAgo)}T09:00:00Z`,
    });
    const one = detectFraud(base({ priorClaims: [recent('A', 10)] }));
    assert.deepEqual(codes(one), []);
    const two = detectFraud(base({ priorClaims: [recent('A', 10), recent('B', 90)] }));
    assert.deepEqual(codes(two), ['FREQUENT_CLAIMS']);
    assert.match(two.flags[0].message, /2 other claims/);
    // 91 days ago is outside the window; rejected claims do not count.
    assert.deepEqual(codes(detectFraud(base({ priorClaims: [recent('A', 10), recent('B', 91)] }))), []);
    assert.deepEqual(codes(detectFraud(base({ priorClaims: [recent('A', 10), recent('B', 20, 'REJECTED')] }))), []);
  });

  test('TC-Fraud-09: NO_SUPPORTING_DOCUMENTS fires when nothing is uploaded (also the default)', () => {
    assert.deepEqual(codes(detectFraud(base({ documentsCount: 0 }))), ['NO_SUPPORTING_DOCUMENTS']);
    const { documentsCount, priorClaims, ...rest } = base();
    const defaults = detectFraud(rest);
    assert.deepEqual(codes(defaults), ['NO_SUPPORTING_DOCUMENTS'], 'documentsCount defaults to 0, priorClaims to []');
    assert.equal(defaults.score, 15);
  });

  test('TC-Fraud-10: LATE_REPORTING fires only when reported more than 30 days after the incident', () => {
    const incident = '2026-05-01';
    const day30 = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 20000, incidentDate: incident }, reportedOn: addDays(incident, 30) }));
    assert.deepEqual(codes(day30), []);
    const day31 = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 20000, incidentDate: incident }, reportedOn: addDays(incident, 31) }));
    assert.deepEqual(codes(day31), ['LATE_REPORTING']);
    assert.equal(day31.score, 10);
  });

  test('TC-Fraud-11: points add up, the score is capped at 100 and the flag threshold is 50', () => {
    assert.equal(FLAG_THRESHOLD, 50);
    // EARLY (25) + FREQUENT (25) = 50: flagged exactly at the threshold.
    const start = POLICY.start_date;
    const recent = [prior({ id: 'A', claim_type: 'accident', incident_date: '2025-01-01', created_at: `${start}T00:00:00Z` }),
      prior({ id: 'B', claim_type: 'accident', incident_date: '2025-01-01', created_at: `${start}T00:00:00Z` })];
    const atThreshold = detectFraud(base({ claim: { claimType: 'hospitalization', amount: 20000, incidentDate: addDays(start, 5) }, reportedOn: addDays(start, 5), priorClaims: recent }));
    assert.equal(atThreshold.score, 50);
    assert.equal(atThreshold.flagged, true);

    // Every rule at once: 60 + 30 + 25 + 35 + 25 + 15 + 10 = 200, capped at 100.
    // (RAPID_INCEPTION_HIGH_VALUE, +35, was added in Sprint 4 by Surya.)
    const incident = addDays(start, 10);
    const all = detectFraud({
      claim: { claimType: 'hospitalization', amount: 600000, incidentDate: incident },
      policy: POLICY,
      priorClaims: [prior({ id: 'D', incident_date: incident, created_at: `${addDays(incident, 40)}T00:00:00Z` }), ...recent.map((c) => ({ ...c, created_at: `${addDays(incident, 40)}T00:00:00Z` }))],
      documentsCount: 0,
      reportedOn: addDays(incident, 45),
      remainingCover: 500000,
    });
    assert.deepEqual(codes(all), ['DUPLICATE_CLAIM', 'EARLY_CLAIM', 'EXCEEDS_REMAINING_COVER', 'FREQUENT_CLAIMS', 'LATE_REPORTING', 'NO_SUPPORTING_DOCUMENTS', 'RAPID_INCEPTION_HIGH_VALUE']);
    assert.equal(all.score, 100);
    assert.equal(all.flagged, true);
  });
});

describe('Settlement formula (IWA-F-023)', () => {
  test('TC-Settle-02: health applies the 5,000 deductible and 10% co-pay', () => {
    const s = computeSettlement({ coverageType: 'health', approvedAmount: 90000, sumInsured: 100000 });
    assert.deepEqual(s, {
      approvedAmount: 90000, remainingCover: 100000, eligibleAmount: 90000, deductible: 5000,
      copayRate: 0.1, copayAmount: 8500, payableAmount: 76500,
    });
  });

  test('TC-Settle-03: motor, home and life use their own deductibles and no co-pay', () => {
    assert.equal(computeSettlement({ coverageType: 'motor', approvedAmount: 50000, sumInsured: 600000 }).payableAmount, 47500);
    assert.equal(computeSettlement({ coverageType: 'home', approvedAmount: 50000, sumInsured: 2500000 }).payableAmount, 40000);
    const life = computeSettlement({ coverageType: 'life', approvedAmount: 1000000, sumInsured: 1000000 });
    assert.equal(life.payableAmount, 1000000);
    assert.equal(life.copayAmount, 0);
    assert.deepEqual(Object.keys(POLICY_TERMS).sort(), ['health', 'home', 'life', 'motor']);
  });

  test('TC-Settle-04: the eligible amount is capped at the remaining cover after earlier payouts', () => {
    // Remaining cover drops by what was actually paid (76,500), not by the 90,000 claimed.
    const s = computeSettlement({ coverageType: 'health', approvedAmount: 30000, sumInsured: 100000, alreadySettled: 76500 });
    assert.equal(s.remainingCover, 23500);
    assert.equal(s.eligibleAmount, 23500);
    assert.equal(s.copayAmount, 1850);
    assert.equal(s.payableAmount, 16650);
  });

  test('TC-Settle-05: nothing is payable when the cover is used up or the amount is under the deductible', () => {
    const exhausted = computeSettlement({ coverageType: 'motor', approvedAmount: 10000, sumInsured: 100000, alreadySettled: 150000 });
    assert.equal(exhausted.remainingCover, 0, 'remaining cover never goes negative');
    assert.equal(exhausted.payableAmount, 0);
    const small = computeSettlement({ coverageType: 'home', approvedAmount: 9999.99, sumInsured: 1000000 });
    assert.equal(small.payableAmount, 0);
    assert.equal(small.copayAmount, 0);
  });

  test('TC-Settle-06: amounts are rounded to 2 decimals', () => {
    const s = computeSettlement({ coverageType: 'health', approvedAmount: 12345.678, sumInsured: 500000 });
    assert.equal(s.approvedAmount, 12345.68);
    assert.equal(s.copayAmount, 734.57);
    assert.equal(s.payableAmount, 6611.11);
  });

  test('TC-Settle-07: an unknown coverage type is refused', () => {
    assert.throws(() => computeSettlement({ coverageType: 'travel', approvedAmount: 1000, sumInsured: 100000 }), /No settlement terms for coverage 'travel'/);
  });
});

// Quote Service (IWA-F-001): personalized premium from age, income, coverage
// type and term, with a full premium breakdown.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { addDays, today, round2, ageOn, parseJson } = require('../core/util');
const { badRequest, notFound, unavailable, forbidden } = require('../core/errors');

// Product rules. Rates are annual premium per 1,000 of sum insured.
const PRODUCTS = {
  health: { rate: 18, minAge: 18, maxAge: 65, maxTerm: 3, defaultSumInsured: () => 500_000, maxSumInsured: () => 10_000_000 },
  life: { rate: 2.5, minAge: 18, maxAge: 60, maxTerm: 30, defaultSumInsured: (inc) => Math.max(1_000_000, inc * 10), maxSumInsured: (inc) => Math.max(1_000_000, inc * 20) },
  motor: { rate: 30, minAge: 18, maxAge: 75, maxTerm: 3, defaultSumInsured: () => 600_000, maxSumInsured: () => 5_000_000 },
  home: { rate: 1.2, minAge: 18, maxAge: 75, maxTerm: 5, defaultSumInsured: () => 2_500_000, maxSumInsured: () => 50_000_000 },
};

function ageFactor(type, age) {
  if (type === 'motor') return age < 25 ? 1.35 : age > 65 ? 1.2 : 1.0;
  if (type === 'home') return 1.0;
  const bands = type === 'life'
    ? [[30, 0.8], [40, 1.0], [50, 1.6], [61, 2.6]]
    : [[25, 0.8], [35, 1.0], [45, 1.3], [55, 1.7], [66, 2.3]];
  for (const [limit, factor] of bands) if (age < limit) return factor;
  return bands[bands.length - 1][1];
}

// Local actuarial engine. Pure function so it can be unit tested and later
// replaced by a call to the external actuarial API.
function calculatePremium({ coverageType, age, income, term, sumInsured, smoker = false }, gstRate = 0.18) {
  const product = PRODUCTS[coverageType];
  const si = sumInsured ?? product.defaultSumInsured(income);
  const basePremium = (si / 1000) * product.rate;
  const ageLoading = basePremium * (ageFactor(coverageType, age) - 1);
  const smokerLoading = smoker && (coverageType === 'health' || coverageType === 'life') ? (basePremium + ageLoading) * 0.25 : 0;
  const annual = basePremium + ageLoading + smokerLoading;
  const termDiscountRate = Math.min(0.15, 0.05 * (term - 1));
  const termDiscount = annual * term * termDiscountRate;
  const netPremium = annual * term - termDiscount;
  const gst = netPremium * gstRate;
  return {
    sumInsured: round2(si),
    breakdown: {
      basePremium: round2(basePremium * term),
      ageLoading: round2(ageLoading * term),
      smokerLoading: round2(smokerLoading * term),
      termDiscount: round2(-termDiscount),
      netPremium: round2(netPremium),
      gst: round2(gst),
      gstRate,
      total: round2(netPremium + gst),
    },
    premium: round2(netPremium + gst),
  };
}

module.exports = function quotesModule(ctx) {
  const { db, config, audit } = ctx;
  const actuarial = { outage: false };

  function validate(input) {
    const errors = [];
    const coverageType = String(input.coverageType || '').toLowerCase();
    const product = PRODUCTS[coverageType];
    const age = Number(input.age);
    const income = Number(input.income);
    const term = input.term === undefined ? 1 : Number(input.term);
    const sumInsured = input.sumInsured === undefined || input.sumInsured === null || input.sumInsured === '' ? undefined : Number(input.sumInsured);
    if (!product) errors.push(`coverageType must be one of ${Object.keys(PRODUCTS).join(', ')}`);
    if (!Number.isInteger(age)) errors.push('age must be a whole number');
    if (!Number.isFinite(income) || income < 0) errors.push('income must be a non-negative number');
    if (!Number.isInteger(term) || term < 1) errors.push('term must be a positive whole number of years');
    if (product) {
      if (Number.isInteger(age) && (age < product.minAge || age > product.maxAge)) errors.push(`age must be between ${product.minAge} and ${product.maxAge} for ${coverageType}`);
      if (Number.isInteger(term) && term > product.maxTerm) errors.push(`term cannot exceed ${product.maxTerm} years for ${coverageType}`);
      if (sumInsured !== undefined) {
        if (!Number.isFinite(sumInsured) || sumInsured < 50_000) errors.push('sumInsured must be at least 50,000');
        else if (Number.isFinite(income) && sumInsured > product.maxSumInsured(income)) errors.push(`sumInsured exceeds the maximum allowed for this income`);
      }
    }
    if (errors.length) throw badRequest(errors[0], errors);
    return { coverageType, age, income, term, sumInsured, smoker: input.smoker === true || input.smoker === 'true' };
  }

  function createQuote(body, user) {
    let input = { ...body };
    let customerId = null;
    if (body.customerId) {
      const customer = ctx.services.customers.getAccessible(user, body.customerId);
      customerId = customer.id;
      input = { ...input, age: ageOn(customer.dob), income: input.income ?? customer.income };
    } else if (user?.role === 'CUSTOMER') {
      customerId = ctx.services.customers.customerIdForUser(user.id);
    }
    const q = validate(input);
    if (actuarial.outage) throw unavailable('Actuarial service unavailable');
    const calc = calculatePremium(q, config.gstRate);
    const quote = {
      quoteId: newId('Q'),
      customerId,
      coverageType: q.coverageType,
      age: q.age,
      income: q.income,
      term: q.term,
      smoker: q.smoker,
      sumInsured: calc.sumInsured,
      premium: calc.premium,
      breakdown: calc.breakdown,
      validUntil: addDays(today(), config.quoteValidityDays),
      status: 'OPEN',
    };
    db.run(
      `INSERT INTO quotes (id, customer_id, coverage_type, age, income, term, sum_insured, smoker, premium, breakdown, valid_until, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      quote.quoteId, customerId, quote.coverageType, quote.age, quote.income, quote.term, quote.sumInsured,
      quote.smoker ? 1 : 0, quote.premium, JSON.stringify(quote.breakdown), quote.validUntil, 'OPEN', nowIso(),
    );
    audit.record(user?.id || 'anonymous', 'QUOTE_CREATED', 'quote', quote.quoteId, { coverageType: quote.coverageType, premium: quote.premium });
    return quote;
  }

  const present = (r) => ({
    quoteId: r.id, customerId: r.customer_id, coverageType: r.coverage_type, age: r.age, income: r.income, term: r.term,
    smoker: !!r.smoker, sumInsured: r.sum_insured, premium: r.premium, breakdown: parseJson(r.breakdown, {}),
    validUntil: r.valid_until, status: r.status, createdAt: r.created_at,
  });

  const router = express.Router();

  router.post('/', (req, res) => {
    const started = process.hrtime.bigint();
    const quote = createQuote(req.body || {}, req.user);
    res.set('X-Processing-Ms', String(Number(process.hrtime.bigint() - started) / 1e6));
    res.status(201).json(quote);
  });

  router.get('/', (req, res) => {
    if (!req.user) throw forbidden('Login to list quotes');
    let rows;
    if (req.user.role === 'CUSTOMER') {
      rows = db.all('SELECT q.* FROM quotes q JOIN customers c ON c.id = q.customer_id WHERE c.user_id = ? ORDER BY q.created_at DESC', req.user.id);
    } else if (req.user.role === 'AGENT') {
      rows = db.all('SELECT q.* FROM quotes q JOIN customers c ON c.id = q.customer_id WHERE c.agent_id = ? ORDER BY q.created_at DESC', req.user.id);
    } else {
      rows = db.all('SELECT * FROM quotes ORDER BY created_at DESC LIMIT 500');
    }
    res.json(rows.map(present));
  });

  router.get('/:id', (req, res) => {
    const row = db.get('SELECT * FROM quotes WHERE id = ?', req.params.id);
    if (!row) throw notFound('Quote');
    if (row.customer_id && req.user) ctx.services.customers.getAccessible(req.user, row.customer_id);
    else if (row.customer_id) throw forbidden('Login to view this quote');
    res.json(present(row));
  });

  return { createQuote, calculatePremium, present, actuarial, PRODUCTS, router };
};

module.exports.calculatePremium = calculatePremium;
module.exports.PRODUCTS = PRODUCTS;

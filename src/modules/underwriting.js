// Underwriting Service (IWA-F-002, IWA-F-003): KYC gate, rule-based risk
// scoring 0-100 and routing of high-risk applications to manual review.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { ah, ageOn, today, parseJson } = require('../core/util');
const { requireRole } = require('../security/middleware');
const { badRequest, notFound, conflict, unprocessable } = require('../core/errors');

const HAZARDOUS_OCCUPATIONS = ['mining', 'miner', 'armed forces', 'military', 'pilot', 'diver', 'construction', 'firefighter', 'stunt', 'offshore', 'explosives'];

// Pure rule engine (Drools stand-in). Each rule contributes points and a flag.
function scoreRisk({ age, coverageType, sumInsured, income, smoker, conditions = [], occupation = '', previousClaims = 0 }) {
  const flags = [];
  const add = (code, points, message) => flags.push({ code, points, message });

  if (age >= 56) add('AGE_HIGH', 20, `Applicant age ${age} is 56 or above`);
  else if (age >= 46) add('AGE_ELEVATED', 10, `Applicant age ${age} is 46-55`);

  if (smoker && (coverageType === 'health' || coverageType === 'life')) add('SMOKER', 20, 'Applicant declared tobacco use');

  if ((coverageType === 'health' || coverageType === 'life') && conditions.length) {
    add('PRE_EXISTING_CONDITIONS', Math.min(30, conditions.length * 10), `Declared conditions: ${conditions.join(', ')}`);
  }

  const occ = String(occupation).toLowerCase();
  if (occ && HAZARDOUS_OCCUPATIONS.some((h) => occ.includes(h))) add('HAZARDOUS_OCCUPATION', 15, `Occupation '${occupation}' is high hazard`);

  if (coverageType === 'life' || coverageType === 'health') {
    const ratio = income > 0 ? sumInsured / income : Infinity;
    if (ratio > 15) add('HIGH_COVER_TO_INCOME', 20, 'Sum insured is more than 15x annual income');
    else if (ratio > 8) add('ELEVATED_COVER_TO_INCOME', 10, 'Sum insured is more than 8x annual income');
  }

  if (previousClaims > 0) add('PRIOR_CLAIMS', Math.min(24, previousClaims * 8), `${previousClaims} prior claim(s) in the last 3 years`);

  const score = Math.max(0, Math.min(100, flags.reduce((s, f) => s + f.points, 0)));
  return { score, flags };
}

module.exports = function underwritingModule(ctx) {
  const { db, config, audit, bus } = ctx;

  const riskThreshold = () => Number(db.get("SELECT value FROM settings WHERE key = 'riskThreshold'")?.value ?? config.riskThreshold);

  function setStatus(appId, status, extra = {}) {
    db.run(
      `UPDATE applications SET status = ?, risk_score = COALESCE(?, risk_score), risk_flags = COALESCE(?, risk_flags),
         decided_by = COALESCE(?, decided_by), decision_note = COALESCE(?, decision_note), updated_at = ? WHERE id = ?`,
      status, extra.riskScore ?? null, extra.riskFlags ? JSON.stringify(extra.riskFlags) : null,
      extra.decidedBy ?? null, extra.note ?? null, nowIso(), appId,
    );
  }

  // Run risk scoring for an application whose customer passed KYC.
  function assess(app) {
    const quote = db.get('SELECT * FROM quotes WHERE id = ?', app.quote_id);
    const decl = parseJson(app.declarations, {});
    const { score, flags } = scoreRisk({
      age: quote.age,
      coverageType: quote.coverage_type,
      sumInsured: quote.sum_insured,
      income: quote.income,
      smoker: !!quote.smoker || decl.smoker === true,
      conditions: decl.conditions || [],
      occupation: decl.occupation || '',
      previousClaims: Number(decl.previousClaims || 0),
    });
    const threshold = riskThreshold();
    const status = score >= threshold ? 'MANUAL_REVIEW' : 'APPROVED';
    setStatus(app.id, status, { riskScore: score, riskFlags: flags, decidedBy: status === 'APPROVED' ? 'rule-engine' : null });
    audit.record('rule-engine', 'RISK_SCORED', 'application', app.id, { score, threshold, status });
    const message = status === 'APPROVED'
      ? `Application ${app.id} approved. Complete the premium payment to issue your policy.`
      : `Application ${app.id} is under underwriter review.`;
    ctx.services.notifications.notifyCustomer(app.customer_id, 'APPLICATION_' + status, message);
    if (status === 'MANUAL_REVIEW') ctx.services.notifications.notifyRole('UNDERWRITER', 'APPLICATION_REVIEW', `Application ${app.id} scored ${score} and needs review`);
    return { status, riskScore: score, riskFlags: flags, threshold };
  }

  async function apply(body, user) {
    const quote = db.get('SELECT * FROM quotes WHERE id = ?', body.quoteId);
    if (!quote) throw notFound('Quote');
    if (quote.status !== 'OPEN') throw conflict('QUOTE_USED', 'Quote has already been used');
    if (quote.valid_until < today()) throw unprocessable('QUOTE_EXPIRED', 'Quote has expired; request a new one');

    const customerId = quote.customer_id || body.customerId || (user.role === 'CUSTOMER' ? ctx.services.customers.customerIdForUser(user.id) : null);
    if (!customerId) throw badRequest('Create your customer profile before applying');
    const customer = ctx.services.customers.getAccessible(user, customerId);
    if (ageOn(customer.dob) !== quote.age) throw unprocessable('QUOTE_MISMATCH', 'Quote age does not match the customer profile; request a new quote');

    const decl = body.declarations || {};
    if (decl.conditions && !Array.isArray(decl.conditions)) throw badRequest('declarations.conditions must be an array');

    const app = { id: newId('A'), quote_id: quote.id, customer_id: customer.id, declarations: JSON.stringify(decl) };
    db.transaction(() => {
      db.run("UPDATE quotes SET status = 'USED', customer_id = ? WHERE id = ?", customer.id, quote.id);
      db.run(
        `INSERT INTO applications (id, quote_id, customer_id, declarations, status, created_at, updated_at) VALUES (?,?,?,?, 'SUBMITTED', ?, ?)`,
        app.id, app.quote_id, app.customer_id, app.declarations, nowIso(), nowIso(),
      );
    });
    audit.record(user.id, 'APPLICATION_SUBMITTED', 'application', app.id, { quoteId: quote.id });

    // KYC must pass before a policy can be issued (IWA-F-003).
    const kyc = await ctx.services.customers.runKyc(customer.id, user.id);
    if (kyc.status === 'FAILED') {
      setStatus(app.id, 'KYC_FAILED', { note: kyc.reason });
      return { applicationId: app.id, status: 'KYC_FAILED', kyc };
    }
    if (kyc.status !== 'VERIFIED') {
      setStatus(app.id, 'PENDING_KYC', { note: kyc.reason });
      return { applicationId: app.id, status: 'PENDING_KYC', kyc };
    }
    return { applicationId: app.id, kyc, ...assess(app) };
  }

  // When manual KYC resolves, continue the applications waiting on it.
  bus.subscribe('customer.kyc_updated', ({ customerId, status }) => {
    for (const app of db.all("SELECT * FROM applications WHERE customer_id = ? AND status = 'PENDING_KYC'", customerId)) {
      if (status === 'VERIFIED') assess(app);
      else setStatus(app.id, 'KYC_FAILED', { note: 'Manual KYC failed' });
    }
  });

  const present = (r) => {
    const quote = db.get('SELECT coverage_type, sum_insured, premium, term FROM quotes WHERE id = ?', r.quote_id);
    return {
      applicationId: r.id, quoteId: r.quote_id, customerId: r.customer_id,
      customerName: db.get('SELECT name FROM customers WHERE id = ?', r.customer_id)?.name,
      coverageType: quote?.coverage_type, sumInsured: quote?.sum_insured, premium: quote?.premium, term: quote?.term,
      status: r.status, riskScore: r.risk_score, riskFlags: parseJson(r.risk_flags, []), declarations: parseJson(r.declarations, {}),
      decidedBy: r.decided_by, decisionNote: r.decision_note, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  };

  const router = express.Router();

  router.post('/', requireRole('CUSTOMER', 'AGENT'), ah(async (req, res) => {
    if (!req.body?.quoteId) throw badRequest('quoteId is required');
    res.status(201).json(await apply(req.body, req.user));
  }));

  router.get('/', (req, res) => {
    let rows;
    if (req.user.role === 'CUSTOMER') rows = db.all('SELECT a.* FROM applications a JOIN customers c ON c.id = a.customer_id WHERE c.user_id = ? ORDER BY a.created_at DESC', req.user.id);
    else if (req.user.role === 'AGENT') rows = db.all('SELECT a.* FROM applications a JOIN customers c ON c.id = a.customer_id WHERE c.agent_id = ? ORDER BY a.created_at DESC', req.user.id);
    else if (req.query.status) rows = db.all('SELECT * FROM applications WHERE status = ? ORDER BY created_at', String(req.query.status));
    else rows = db.all('SELECT * FROM applications ORDER BY created_at DESC LIMIT 500');
    res.json(rows.map(present));
  });

  router.get('/:id', (req, res) => {
    const row = db.get('SELECT * FROM applications WHERE id = ?', req.params.id);
    if (!row) throw notFound('Application');
    ctx.services.customers.getAccessible(req.user, row.customer_id);
    res.json(present(row));
  });

  router.post('/:id/decision', requireRole('UNDERWRITER'), (req, res) => {
    const row = db.get('SELECT * FROM applications WHERE id = ?', req.params.id);
    if (!row) throw notFound('Application');
    if (row.status !== 'MANUAL_REVIEW') throw conflict('NOT_IN_REVIEW', 'Application is not awaiting manual review');
    const { decision, note } = req.body || {};
    if (!['APPROVE', 'REJECT'].includes(decision)) throw badRequest("decision must be 'APPROVE' or 'REJECT'");
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    setStatus(row.id, status, { decidedBy: req.user.id, note: note || null });
    audit.record(req.user.id, 'APPLICATION_' + status, 'application', row.id, { note: note || null });
    ctx.services.notifications.notifyCustomer(row.customer_id, 'APPLICATION_' + status,
      status === 'APPROVED' ? `Application ${row.id} approved by underwriting. Complete payment to issue your policy.` : `Application ${row.id} was declined by underwriting.`);
    res.json(present(db.get('SELECT * FROM applications WHERE id = ?', row.id)));
  });

  return { apply, assess, scoreRisk, riskThreshold, router };
};

module.exports.scoreRisk = scoreRisk;

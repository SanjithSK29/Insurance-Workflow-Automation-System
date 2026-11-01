// Policy Service (IWA-F-010..012): issuance with signed PDF, renewal with
// 30/15/7-day reminders, endorsements with an audit trail.
const crypto = require('node:crypto');
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { ah, addDays, addYears, daysBetween, today, round2, ageOn, parseJson } = require('../core/util');
const { requireRole } = require('../security/middleware');
const { calculatePremium, PRODUCTS } = require('./quotes');
const { badRequest, notFound, conflict, unprocessable } = require('../core/errors');

const ENDORSABLE = ['nominee', 'address', 'sumInsured'];
const RENEWAL_WINDOW_DAYS = 60;

module.exports = function policiesModule(ctx) {
  const { db, config, audit, bus } = ctx;
  const inr = (n) => `INR ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  function policyNumber() {
    for (;;) {
      const n = `IWAS-${new Date().getUTCFullYear()}-${crypto.randomInt(100000, 999999)}`;
      if (!db.get('SELECT id FROM policies WHERE policy_number = ?', n)) return n;
    }
  }

  function renderPolicyPdf(policyId) {
    const p = db.get('SELECT * FROM policies WHERE id = ?', policyId);
    const c = db.get('SELECT name, dob FROM customers WHERE id = ?', p.customer_id);
    const doc = ctx.services.documents.generateSignedPdf({
      kind: 'POLICY',
      ownerCustomerId: p.customer_id,
      referenceId: p.id,
      filename: `${p.policy_number}-v${p.version}.pdf`,
      title: `Policy ${p.policy_number}`,
      lines: [
        { text: 'IWAS Insurance', size: 18, bold: true },
        { text: 'Policy Schedule', size: 14, bold: true, gap: 4 },
        { rule: true, gap: 4 },
        `Policy number: ${p.policy_number}`,
        `Version: ${p.version}`,
        `Policyholder: ${c.name} (DOB ${c.dob})`,
        `Coverage: ${p.coverage_type.toUpperCase()}`,
        `Sum insured: ${inr(p.sum_insured)}`,
        `Premium paid: ${inr(p.premium)} (incl. GST)`,
        `Period of insurance: ${p.start_date} to ${p.end_date}`,
        `Nominee: ${p.nominee || 'Not specified'}`,
        `Address: ${p.address || 'Not specified'}`,
        { text: 'Terms', bold: true, gap: 8 },
        'This policy is issued subject to the terms, conditions and exclusions of the product wording.',
        'Claims may be registered online at any time during the period of insurance.',
        `Issued on ${today()}.`,
      ],
    });
    db.run('UPDATE policies SET document_id = ? WHERE id = ?', doc.id, p.id);
    return doc;
  }

  function issue(app, paymentId, actorId) {
    const quote = db.get('SELECT * FROM quotes WHERE id = ?', app.quote_id);
    const start = today();
    const policy = { id: newId('P'), number: policyNumber() };
    db.transaction(() => {
      db.run(
        `INSERT INTO policies (id, policy_number, application_id, customer_id, coverage_type, sum_insured, premium, term, start_date, end_date, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'ACTIVE', ?)`,
        policy.id, policy.number, app.id, app.customer_id, quote.coverage_type, quote.sum_insured, quote.premium, quote.term,
        start, addDays(addYears(start, quote.term), -1), nowIso(),
      );
      db.run("UPDATE applications SET status = 'ISSUED', updated_at = ? WHERE id = ?", nowIso(), app.id);
      db.run('UPDATE payments SET policy_id = ? WHERE id = ?', policy.id, paymentId);
    });
    const doc = renderPolicyPdf(policy.id);
    audit.record(actorId, 'POLICY_ISSUED', 'policy', policy.id, { policyNumber: policy.number, paymentId, documentId: doc.id });
    ctx.services.notifications.notifyCustomer(app.customer_id, 'POLICY_ISSUED', `Policy ${policy.number} has been issued. Your signed policy document is ready to download.`);
    bus.publish('policy.issued', { policyId: policy.id, customerId: app.customer_id });
    return present(db.get('SELECT * FROM policies WHERE id = ?', policy.id));
  }

  function renewalQuote(p) {
    const customer = db.get('SELECT dob, income FROM customers WHERE id = ?', p.customer_id);
    const age = ageOn(customer.dob);
    const product = PRODUCTS[p.coverage_type];
    if (age > product.maxAge) throw unprocessable('NOT_RENEWABLE', `Maximum renewal age for ${p.coverage_type} is ${product.maxAge}`);
    const calc = calculatePremium({ coverageType: p.coverage_type, age, income: customer.income, term: p.term, sumInsured: p.sum_insured }, config.gstRate);
    return { policyId: p.id, premium: calc.premium, breakdown: calc.breakdown, newEndDate: addYears(p.end_date, p.term), daysToExpiry: daysBetween(today(), p.end_date) };
  }

  async function renew(policyId, token, user) {
    const p = getAccessible(user, policyId);
    if (!['ACTIVE', 'EXPIRED'].includes(p.status)) throw conflict('NOT_RENEWABLE', `Policy is ${p.status}`);
    const daysLeft = daysBetween(today(), p.end_date);
    if (daysLeft > RENEWAL_WINDOW_DAYS) throw conflict('TOO_EARLY', `Renewal opens ${RENEWAL_WINDOW_DAYS} days before expiry`);
    if (daysLeft < -30) throw conflict('LAPSED', 'Grace period of 30 days has passed; buy a new policy');
    const rq = renewalQuote(p);
    const payment = await ctx.services.payments.charge({ purpose: 'RENEWAL', referenceId: p.id, policyId: p.id, total: rq.premium, token, actorId: user.id });
    db.run("UPDATE policies SET end_date = ?, premium = ?, status = 'ACTIVE', version = version + 1 WHERE id = ?", rq.newEndDate, rq.premium, p.id);
    const doc = renderPolicyPdf(p.id);
    const invoice = ctx.services.payments.generateInvoice(payment.paymentId, { customerId: p.customer_id, policyNumber: p.policy_number, description: `Renewal premium until ${rq.newEndDate}` });
    audit.record(user.id, 'POLICY_RENEWED', 'policy', p.id, { newEndDate: rq.newEndDate, paymentId: payment.paymentId });
    ctx.services.notifications.notifyCustomer(p.customer_id, 'POLICY_RENEWED', `Policy ${p.policy_number} renewed until ${rq.newEndDate}.`);
    return { policy: present(db.get('SELECT * FROM policies WHERE id = ?', p.id)), payment, documentId: doc.id, invoiceDocumentId: invoice.id };
  }

  function endorse(policyId, changes, user) {
    const p = getAccessible(user, policyId);
    if (p.status !== 'ACTIVE') throw conflict('NOT_ACTIVE', 'Only active policies can be endorsed');
    const keys = Object.keys(changes || {}).filter((k) => changes[k] !== undefined && changes[k] !== '');
    if (!keys.length) throw badRequest(`Provide at least one of: ${ENDORSABLE.join(', ')}`);
    const unknown = keys.filter((k) => !ENDORSABLE.includes(k));
    if (unknown.length) throw badRequest(`Cannot endorse field(s): ${unknown.join(', ')}`);

    const previous = {};
    const next = {};
    let premiumAdjustment = 0;
    if (changes.nominee !== undefined) {
      const v = String(changes.nominee).trim();
      if (v.length < 2 || v.length > 100) throw badRequest('nominee must be 2-100 characters');
      previous.nominee = p.nominee; next.nominee = v;
    }
    if (changes.address !== undefined) {
      const v = String(changes.address).trim();
      if (v.length < 5 || v.length > 300) throw badRequest('address must be 5-300 characters');
      previous.address = p.address; next.address = v;
    }
    if (changes.sumInsured !== undefined) {
      const si = Number(changes.sumInsured);
      const customer = db.get('SELECT dob, income FROM customers WHERE id = ?', p.customer_id);
      if (!Number.isFinite(si) || si < 50_000) throw badRequest('sumInsured must be at least 50,000');
      if (si > PRODUCTS[p.coverage_type].maxSumInsured(customer.income)) throw badRequest('sumInsured exceeds the maximum allowed for this income');
      // Pro-rata premium difference for the remaining period.
      const age = ageOn(customer.dob);
      const annual = (sum) => calculatePremium({ coverageType: p.coverage_type, age, income: customer.income, term: 1, sumInsured: sum }, config.gstRate).premium;
      const remaining = Math.max(0, daysBetween(today(), p.end_date)) / 365;
      premiumAdjustment = round2((annual(si) - annual(p.sum_insured)) * remaining);
      previous.sumInsured = p.sum_insured; next.sumInsured = si;
    }

    const endorsementId = newId('E');
    db.transaction(() => {
      db.run(
        `UPDATE policies SET nominee = COALESCE(?, nominee), address = COALESCE(?, address), sum_insured = COALESCE(?, sum_insured), version = version + 1 WHERE id = ?`,
        next.nominee ?? null, next.address ?? null, next.sumInsured ?? null, p.id,
      );
      db.run(
        'INSERT INTO endorsements (id, policy_id, changes, previous, premium_adjustment, endorsed_by, created_at) VALUES (?,?,?,?,?,?,?)',
        endorsementId, p.id, JSON.stringify(next), JSON.stringify(previous), premiumAdjustment, user.id, nowIso(),
      );
    });
    renderPolicyPdf(p.id);
    audit.record(user.id, 'POLICY_ENDORSED', 'policy', p.id, { endorsementId, fields: Object.keys(next), previous, changes: next, premiumAdjustment });
    ctx.services.notifications.notifyCustomer(p.customer_id, 'POLICY_ENDORSED', `Policy ${p.policy_number} was updated (${Object.keys(next).join(', ')}).`);
    return { endorsementId, premiumAdjustment, policy: present(db.get('SELECT * FROM policies WHERE id = ?', p.id)) };
  }

  // Daily job: renewal reminders at 30/15/7 days and expiry (IWA-F-011).
  function runRenewalReminders(asOf = today()) {
    const sent = [];
    const thresholds = [...config.reminderDays].sort((a, b) => a - b);
    db.run("UPDATE policies SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND end_date < ?", asOf);
    for (const p of db.all("SELECT * FROM policies WHERE status = 'ACTIVE' AND end_date >= ?", asOf)) {
      const daysLeft = daysBetween(asOf, p.end_date);
      const due = thresholds.find((d) => daysLeft <= d);
      if (due === undefined) continue;
      if (db.get('SELECT 1 FROM reminders_sent WHERE policy_id = ? AND end_date = ? AND days_before = ?', p.id, p.end_date, due)) continue;
      // Mark this and any larger (skipped) thresholds so each fires once.
      for (const d of thresholds.filter((t) => t >= due)) {
        db.run('INSERT OR IGNORE INTO reminders_sent (policy_id, end_date, days_before, sent_at) VALUES (?,?,?,?)', p.id, p.end_date, d, nowIso());
      }
      ctx.services.notifications.notifyCustomer(p.customer_id, 'RENEWAL_REMINDER',
        `Policy ${p.policy_number} expires in ${daysLeft} day(s) on ${p.end_date}. Renew now to stay covered.`);
      sent.push({ policyId: p.id, policyNumber: p.policy_number, daysLeft, reminder: due });
    }
    if (sent.length) audit.record('scheduler', 'RENEWAL_REMINDERS_SENT', 'policy', null, { count: sent.length, asOf });
    return sent;
  }

  function getAccessible(user, policyId) {
    const p = db.get('SELECT * FROM policies WHERE id = ? OR policy_number = ?', policyId, policyId);
    if (!p) throw notFound('Policy');
    ctx.services.customers.getAccessible(user, p.customer_id);
    return p;
  }

  const present = (p) => ({
    policyId: p.id, policyNumber: p.policy_number, applicationId: p.application_id, customerId: p.customer_id,
    customerName: db.get('SELECT name FROM customers WHERE id = ?', p.customer_id)?.name,
    coverageType: p.coverage_type, sumInsured: p.sum_insured, premium: p.premium, term: p.term,
    startDate: p.start_date, endDate: p.end_date, status: p.status, version: p.version,
    nominee: p.nominee, address: p.address, documentId: p.document_id, createdAt: p.created_at,
  });

  const router = express.Router();

  router.get('/', (req, res) => {
    let rows;
    if (req.user.role === 'CUSTOMER') rows = db.all('SELECT p.* FROM policies p JOIN customers c ON c.id = p.customer_id WHERE c.user_id = ? ORDER BY p.created_at DESC', req.user.id);
    else if (req.user.role === 'AGENT') rows = db.all('SELECT p.* FROM policies p JOIN customers c ON c.id = p.customer_id WHERE c.agent_id = ? ORDER BY p.created_at DESC', req.user.id);
    else rows = db.all('SELECT * FROM policies ORDER BY created_at DESC LIMIT 500');
    res.json(rows.map(present));
  });

  router.get('/:id', (req, res) => {
    const p = getAccessible(req.user, req.params.id);
    res.json({
      ...present(p),
      endorsements: db.all('SELECT * FROM endorsements WHERE policy_id = ? ORDER BY created_at', p.id)
        .map((e) => ({ ...e, changes: parseJson(e.changes, {}), previous: parseJson(e.previous, {}) })),
      documents: db.all("SELECT id, kind, filename, created_at FROM documents WHERE reference_id = ? OR reference_id IN (SELECT id FROM payments WHERE policy_id = ?) ORDER BY created_at", p.id, p.id),
    });
  });

  router.get('/:id/renewal-quote', (req, res) => res.json(renewalQuote(getAccessible(req.user, req.params.id))));

  router.post('/:id/renew', requireRole('CUSTOMER', 'AGENT'), ah(async (req, res) => {
    if (!req.body?.paymentToken) throw badRequest('paymentToken is required');
    res.json(await renew(req.params.id, req.body.paymentToken, req.user));
  }));

  router.post('/:id/endorse', requireRole('CUSTOMER', 'AGENT', 'ADMIN'), (req, res) => {
    res.json(endorse(req.params.id, req.body || {}, req.user));
  });

  return { issue, renew, endorse, runRenewalReminders, getAccessible, present, router };
};

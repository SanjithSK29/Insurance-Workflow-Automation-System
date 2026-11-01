// Customer onboarding and KYC verification (IWA-F-003).
// PII is encrypted at rest and masked in responses for non-authorized roles.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { ah, ageOn, isIsoDate } = require('../core/util');
const { CircuitBreaker, retry } = require('../core/resilience');
const { requireRole } = require('../security/middleware');
const { maskAadhaar, maskPan, maskPhone, maskEmail, canSeePii } = require('../security/pii');
const { badRequest, notFound, forbidden, conflict } = require('../core/errors');

const AADHAAR_RE = /^[2-9]\d{11}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Built-in KYC provider adapter (Aadhaar/PAN verification sandbox).
// Replace `verify` with a real provider client in production.
function createKycProvider() {
  const provider = {
    outage: false,
    async verify({ aadhaar, pan, name }) {
      if (provider.outage) throw new Error('KYC provider unavailable');
      if (pan[3] !== 'P') return { status: 'FAILED', reason: 'PAN does not belong to an individual' };
      if (aadhaar.endsWith('0000')) return { status: 'FAILED', reason: 'Aadhaar details do not match records' };
      if (!name) return { status: 'FAILED', reason: 'Name missing' };
      return { status: 'VERIFIED', reference: `KYC-${Date.now().toString(36).toUpperCase()}` };
    },
  };
  return provider;
}

module.exports = function customersModule(ctx) {
  const { db, crypto, audit } = ctx;
  const kycProvider = createKycProvider();
  const kycBreaker = new CircuitBreaker('kyc-provider', { failureThreshold: 3, resetMs: 30_000 });

  function validateProfile(body, { partial = false } = {}) {
    const p = {
      name: body.name?.trim(),
      dob: body.dob,
      income: Number(body.income),
      email: body.email?.trim().toLowerCase() || null,
      phone: body.phone ? String(body.phone).replace(/\D/g, '').slice(-10) : null,
      aadhaar: body.aadhaar ? String(body.aadhaar).replace(/[\s-]/g, '') : null,
      pan: body.pan ? String(body.pan).trim().toUpperCase() : null,
    };
    const errors = [];
    if (!partial || body.name !== undefined) if (!p.name || p.name.length < 2) errors.push('name is required');
    if (!partial || body.dob !== undefined) {
      if (!isIsoDate(p.dob)) errors.push('dob must be YYYY-MM-DD');
      else if (ageOn(p.dob) < 18) errors.push('customer must be at least 18');
    }
    if (!partial || body.income !== undefined) if (!Number.isFinite(p.income) || p.income < 0) errors.push('income must be a non-negative number');
    if (p.email && !EMAIL_RE.test(p.email)) errors.push('email is invalid');
    if (p.phone && !PHONE_RE.test(p.phone)) errors.push('phone must be a 10-digit Indian mobile number');
    if (p.aadhaar && !AADHAAR_RE.test(p.aadhaar)) errors.push('aadhaar must be 12 digits');
    if (p.pan && !PAN_RE.test(p.pan)) errors.push('pan must look like ABCDE1234F');
    if (errors.length) throw badRequest(errors[0], errors);
    return p;
  }

  function create(body, actor) {
    const p = validateProfile(body);
    const customer = { id: newId('CU') };
    const userId = actor.role === 'CUSTOMER' ? actor.id : null;
    const agentId = actor.role === 'AGENT' ? actor.id : null;
    if (userId && db.get('SELECT id FROM customers WHERE user_id = ?', userId)) throw conflict('PROFILE_EXISTS', 'Profile already exists');
    db.run(
      `INSERT INTO customers (id, user_id, agent_id, name, dob, income, email_enc, phone_enc, aadhaar_enc, pan_enc, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      customer.id, userId, agentId, p.name, p.dob, p.income,
      crypto.encrypt(p.email), crypto.encrypt(p.phone), crypto.encrypt(p.aadhaar), crypto.encrypt(p.pan), nowIso(),
    );
    audit.record(actor.id, 'CUSTOMER_CREATED', 'customer', customer.id, { by: actor.role });
    return customer.id;
  }

  function present(row, user) {
    const full = canSeePii(user);
    const email = crypto.decrypt(row.email_enc);
    const phone = crypto.decrypt(row.phone_enc);
    const aadhaar = crypto.decrypt(row.aadhaar_enc);
    const pan = crypto.decrypt(row.pan_enc);
    return {
      id: row.id,
      name: row.name,
      dob: row.dob,
      age: ageOn(row.dob),
      income: row.income,
      email: full ? email : maskEmail(email),
      phone: full ? phone : maskPhone(phone),
      aadhaar: full ? aadhaar : maskAadhaar(aadhaar),
      pan: full ? pan : maskPan(pan),
      kycStatus: row.kyc_status,
      kycRef: row.kyc_ref,
      agentId: row.agent_id,
      createdAt: row.created_at,
      piiMasked: !full,
    };
  }

  // Shared access rule used by every customer-owned resource.
  function getAccessible(user, customerId) {
    const row = db.get('SELECT * FROM customers WHERE id = ?', customerId);
    if (!row) throw notFound('Customer');
    if (user.role === 'CUSTOMER' && row.user_id !== user.id) throw forbidden('Not your profile');
    if (user.role === 'AGENT' && row.agent_id !== user.id) throw forbidden('Customer is not in your portfolio');
    return row;
  }

  function customerIdForUser(userId) {
    return db.get('SELECT id FROM customers WHERE user_id = ?', userId)?.id || null;
  }

  // Returns the new KYC status. Provider outages route to a manual queue
  // instead of failing the customer (SAD 3.7).
  async function runKyc(customerId, actorId) {
    const row = db.get('SELECT * FROM customers WHERE id = ?', customerId);
    if (row.kyc_status === 'VERIFIED') return { status: 'VERIFIED', reference: row.kyc_ref };
    const aadhaar = crypto.decrypt(row.aadhaar_enc);
    const pan = crypto.decrypt(row.pan_enc);
    if (!aadhaar || !pan) {
      throw badRequest('Aadhaar and PAN are required for KYC');
    }
    let result;
    try {
      result = await kycBreaker.call(() => retry(() => kycProvider.verify({ aadhaar, pan, name: row.name, dob: row.dob }), { attempts: 2, baseMs: 20 }));
    } catch (err) {
      result = { status: 'PENDING_MANUAL', reason: err.circuitOpen ? 'KYC provider circuit open' : 'KYC provider unavailable' };
      ctx.services.notifications.notifyRole('UNDERWRITER', 'KYC_MANUAL_REVIEW', `Customer ${customerId} needs manual KYC review`);
    }
    db.run('UPDATE customers SET kyc_status = ?, kyc_ref = ? WHERE id = ?', result.status, result.reference || null, customerId);
    audit.record(actorId, 'KYC_' + result.status, 'customer', customerId, { reason: result.reason || null });
    return result;
  }

  const router = express.Router();

  router.post('/', requireRole('CUSTOMER', 'AGENT'), (req, res) => {
    const id = create(req.body || {}, req.user);
    res.status(201).json(present(db.get('SELECT * FROM customers WHERE id = ?', id), req.user));
  });

  // Agent bulk onboarding.
  router.post('/bulk', requireRole('AGENT'), (req, res) => {
    const items = Array.isArray(req.body?.customers) ? req.body.customers : null;
    if (!items || !items.length || items.length > 200) throw badRequest('customers must be an array of 1-200 profiles');
    const results = items.map((item, index) => {
      try {
        return { index, id: create(item, req.user), ok: true };
      } catch (err) {
        return { index, ok: false, error: err.message };
      }
    });
    res.status(207).json({ created: results.filter((r) => r.ok).length, results });
  });

  router.get('/', requireRole('AGENT', 'UNDERWRITER', 'ADJUSTER', 'ADMIN', 'CUSTOMER'), (req, res) => {
    let rows;
    if (req.user.role === 'CUSTOMER') rows = db.all('SELECT * FROM customers WHERE user_id = ?', req.user.id);
    else if (req.user.role === 'AGENT') rows = db.all('SELECT * FROM customers WHERE agent_id = ? ORDER BY created_at DESC', req.user.id);
    else if (req.query.kycStatus) rows = db.all('SELECT * FROM customers WHERE kyc_status = ? ORDER BY created_at', String(req.query.kycStatus));
    else rows = db.all('SELECT * FROM customers ORDER BY created_at DESC LIMIT 500');
    res.json(rows.map((r) => present(r, req.user)));
  });

  router.get('/:id', (req, res) => res.json(present(getAccessible(req.user, req.params.id), req.user)));

  router.patch('/:id', requireRole('CUSTOMER', 'AGENT'), (req, res) => {
    const row = getAccessible(req.user, req.params.id);
    const p = validateProfile(req.body || {}, { partial: true });
    const identityChanged = p.aadhaar || p.pan || (p.name && p.name !== row.name) || (p.dob && p.dob !== row.dob);
    db.run(
      `UPDATE customers SET name = COALESCE(?, name), dob = COALESCE(?, dob), income = COALESCE(?, income),
         email_enc = COALESCE(?, email_enc), phone_enc = COALESCE(?, phone_enc), aadhaar_enc = COALESCE(?, aadhaar_enc),
         pan_enc = COALESCE(?, pan_enc), kyc_status = ? WHERE id = ?`,
      p.name || null, p.dob || null, Number.isFinite(p.income) && req.body.income !== undefined ? p.income : null,
      crypto.encrypt(p.email), crypto.encrypt(p.phone), crypto.encrypt(p.aadhaar), crypto.encrypt(p.pan),
      identityChanged ? 'NOT_STARTED' : row.kyc_status, row.id,
    );
    audit.record(req.user.id, 'CUSTOMER_UPDATED', 'customer', row.id, { fields: Object.keys(req.body || {}) });
    res.json(present(db.get('SELECT * FROM customers WHERE id = ?', row.id), req.user));
  });

  router.post('/:id/kyc', requireRole('CUSTOMER', 'AGENT', 'UNDERWRITER'), ah(async (req, res) => {
    getAccessible(req.user, req.params.id);
    res.json(await runKyc(req.params.id, req.user.id));
  }));

  // Manual KYC queue resolution by an underwriter.
  router.post('/:id/kyc/manual', requireRole('UNDERWRITER'), (req, res) => {
    const row = getAccessible(req.user, req.params.id);
    const { decision, note } = req.body || {};
    if (!['VERIFIED', 'FAILED'].includes(decision)) throw badRequest("decision must be 'VERIFIED' or 'FAILED'");
    if (row.kyc_status !== 'PENDING_MANUAL') throw conflict('KYC_NOT_PENDING', 'KYC is not awaiting manual review');
    db.run('UPDATE customers SET kyc_status = ?, kyc_ref = ? WHERE id = ?', decision, decision === 'VERIFIED' ? `MANUAL-${req.user.id}` : null, row.id);
    audit.record(req.user.id, 'KYC_MANUAL_' + decision, 'customer', row.id, { note: note || null });
    ctx.bus.publish('customer.kyc_updated', { customerId: row.id, status: decision });
    res.json({ status: decision });
  });

  return { create, present, getAccessible, customerIdForUser, runKyc, kycProvider, kycBreaker, router };
};

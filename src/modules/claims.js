// Claims Service (IWA-F-020..024): registration with document upload, fraud
// checks, BPMN approval routing, settlement and claimant notifications.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { ah, today, isIsoDate, round2, parseJson } = require('../core/util');
const { requireRole } = require('../security/middleware');
const { detectFraud } = require('./fraud');
const { computeSettlement } = require('./settlement');
const { badRequest, notFound, conflict, unprocessable, forbidden, ApiError } = require('../core/errors');

const CLAIM_TYPES = {
  health: ['hospitalization', 'day-care', 'accident'],
  life: ['death', 'critical-illness'],
  motor: ['accident', 'theft', 'damage'],
  home: ['fire', 'theft', 'flood', 'damage'],
};
const ALLOWED_MIME = {
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};
const MAX_DOCS = 10;
const WORKFLOW_KEY = 'claim-approval';

const STATUS_MESSAGES = {
  REGISTERED: (c) => `Claim ${c.id} has been registered. We will keep you updated.`,
  UNDER_REVIEW: (c) => `Claim ${c.id} is under review by our claims team.`,
  APPROVED: (c, s) => `Claim ${c.id} has been approved. Payable amount: INR ${s?.payableAmount ?? ''}.`,
  REJECTED: (c) => `Claim ${c.id} was not approved. Contact support for details.`,
  SETTLED: (c, s) => `Claim ${c.id} has been settled. INR ${s?.payableAmount ?? ''} has been paid out.`,
};

module.exports = function claimsModule(ctx) {
  const { db, config, audit, bus } = ctx;

  function decodeDocuments(docs = []) {
    if (!Array.isArray(docs)) throw badRequest('documents must be an array');
    if (docs.length > MAX_DOCS) throw badRequest(`At most ${MAX_DOCS} documents per request`);
    return docs.map((d, i) => {
      const mime = String(d?.mime || '').toLowerCase();
      if (!ALLOWED_MIME[mime]) throw badRequest(`Document ${i + 1}: only PDF, PNG and JPEG files are accepted`);
      const filename = String(d.filename || `document-${i + 1}`).replace(/[^\w.\- ]/g, '_').slice(0, 120);
      const content = Buffer.from(String(d.contentBase64 || ''), 'base64');
      if (!content.length) throw badRequest(`Document ${i + 1} is empty`);
      if (content.length > config.maxUploadBytes) throw new ApiError(413, 'FILE_TOO_LARGE', `Document '${filename}' exceeds the 10 MB limit`);
      if (!ALLOWED_MIME[mime](content)) throw badRequest(`Document '${filename}' content does not match ${mime}`);
      return { filename, mime, content };
    });
  }

  function attachDocuments(claim, decoded) {
    return decoded.map((d) => {
      const doc = ctx.services.documents.store({ kind: 'CLAIM_EVIDENCE', ownerCustomerId: claim.customer_id, referenceId: claim.id, ...d });
      db.run('INSERT INTO claim_documents (claim_id, document_id) VALUES (?, ?)', claim.id, doc.id);
      return doc.id;
    });
  }

  function settledOnPolicy(policyId) {
    const rows = db.all("SELECT settlement FROM claims WHERE policy_id = ? AND status = 'SETTLED'", policyId);
    return rows.reduce((s, r) => s + (parseJson(r.settlement, {}).payableAmount || 0), 0);
  }

  function setStatus(claimId, status, settlement) {
    db.run('UPDATE claims SET status = ?, settlement = COALESCE(?, settlement), updated_at = ? WHERE id = ?',
      status, settlement ? JSON.stringify(settlement) : null, nowIso(), claimId);
    const claim = db.get('SELECT * FROM claims WHERE id = ?', claimId);
    audit.record('claims-service', 'CLAIM_' + status, 'claim', claimId, settlement ? { payable: settlement.payableAmount } : {});
    ctx.services.notifications.notifyCustomer(claim.customer_id, 'CLAIM_' + status, STATUS_MESSAGES[status](claim, settlement));
    bus.publish('claim.status_changed', { claimId, status });
    return claim;
  }

  async function register(body, user) {
    const policy = ctx.services.policies.getAccessible(user, body.policyId);
    if (policy.status !== 'ACTIVE') throw unprocessable('POLICY_NOT_ACTIVE', 'Claims can only be filed on active policies');
    const claimType = String(body.claimType || '').toLowerCase();
    if (!CLAIM_TYPES[policy.coverage_type].includes(claimType)) {
      throw unprocessable('INVALID_CLAIM', `claimType must be one of ${CLAIM_TYPES[policy.coverage_type].join(', ')} for ${policy.coverage_type} policies`);
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw unprocessable('INVALID_CLAIM', 'amount must be a positive number');
    if (!isIsoDate(body.incidentDate)) throw unprocessable('INVALID_CLAIM', 'incidentDate must be YYYY-MM-DD');
    if (body.incidentDate > today()) throw unprocessable('INVALID_CLAIM', 'incidentDate cannot be in the future');
    if (body.incidentDate < policy.start_date || body.incidentDate > policy.end_date) throw unprocessable('INVALID_CLAIM', 'Incident date is outside the policy period');
    const description = body.description ? String(body.description).slice(0, 2000) : null;
    const decoded = decodeDocuments(body.documents);

    const priorClaims = db.all('SELECT * FROM claims WHERE policy_id = ?', policy.id);
    const fraud = detectFraud({
      claim: { claimType, amount, incidentDate: body.incidentDate },
      policy,
      priorClaims,
      documentsCount: decoded.length,
      reportedOn: today(),
      remainingCover: policy.sum_insured - settledOnPolicy(policy.id),
    });

    const claim = { id: newId('C'), customer_id: policy.customer_id };
    db.transaction(() => {
      db.run(
        `INSERT INTO claims (id, policy_id, customer_id, claim_type, amount, incident_date, description, status, fraud_score, fraud_flags, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, 'REGISTERED', ?, ?, ?, ?)`,
        claim.id, policy.id, policy.customer_id, claimType, amount, body.incidentDate, description,
        fraud.score, JSON.stringify(fraud.flags), nowIso(), nowIso(),
      );
      attachDocuments(claim, decoded);
    });
    audit.record(user.id, 'CLAIM_REGISTERED', 'claim', claim.id, { policyId: policy.id, amount, fraudScore: fraud.score });
    if (fraud.flagged) audit.record('fraud-engine', 'FRAUD_FLAG_RAISED', 'claim', claim.id, { score: fraud.score, rules: fraud.flags.map((f) => f.code) });
    ctx.services.notifications.notifyCustomer(policy.customer_id, 'CLAIM_REGISTERED', STATUS_MESSAGES.REGISTERED(claim));

    const wf = ctx.services.workflow.start(WORKFLOW_KEY, claim.id, {
      amount, claimType, coverageType: policy.coverage_type, fraudFlagged: fraud.flagged, fraudScore: fraud.score,
    }, user.id);
    db.run('UPDATE claims SET workflow_instance_id = ? WHERE id = ?', wf.instanceId, claim.id);

    const row = db.get('SELECT * FROM claims WHERE id = ?', claim.id);
    return { ...present(row), eta: fraud.flagged ? '10 days' : '5 days' };
  }

  // ---- workflow event consumers ----
  bus.subscribe('workflow.task.created', ({ businessKey, definitionKey, name, candidateGroup: group }) => {
    if (definitionKey !== WORKFLOW_KEY) return;
    const claim = db.get('SELECT * FROM claims WHERE id = ?', businessKey);
    if (!claim) return;
    if (claim.status === 'REGISTERED') setStatus(claim.id, 'UNDER_REVIEW');
    ctx.services.notifications.notifyRole(group, 'TASK_ASSIGNED', `New task '${name}' for claim ${claim.id}`);
  });

  bus.subscribe('workflow.task.completed', ({ businessKey, variables }) => {
    const claim = db.get('SELECT * FROM claims WHERE id = ?', businessKey);
    if (!claim || variables?.approvedAmount === undefined) return;
    const approved = Math.min(claim.amount, Math.max(0, Number(variables.approvedAmount) || 0));
    db.run('UPDATE claims SET approved_amount = ? WHERE id = ?', approved, claim.id);
  });

  bus.subscribe('workflow.completed', ({ businessKey, definitionKey, result }) => {
    if (definitionKey !== WORKFLOW_KEY) return;
    const claim = db.get('SELECT * FROM claims WHERE id = ?', businessKey);
    if (!claim) return;
    if (result === 'APPROVED') {
      const policy = db.get('SELECT * FROM policies WHERE id = ?', claim.policy_id);
      const settlement = computeSettlement({
        coverageType: policy.coverage_type,
        approvedAmount: claim.approved_amount ?? claim.amount,
        sumInsured: policy.sum_insured,
        alreadySettled: settledOnPolicy(policy.id),
      });
      setStatus(claim.id, 'APPROVED', settlement);
    } else {
      setStatus(claim.id, 'REJECTED');
    }
  });

  async function settle(claimId, user) {
    const claim = db.get('SELECT * FROM claims WHERE id = ?', claimId);
    if (!claim) throw notFound('Claim');
    if (claim.status !== 'APPROVED') throw conflict('NOT_APPROVED', `Claim is ${claim.status}; only approved claims can be settled`);
    const policy = db.get('SELECT * FROM policies WHERE id = ?', claim.policy_id);
    // Recompute against current remaining cover in case other claims settled meanwhile.
    const settlement = computeSettlement({
      coverageType: policy.coverage_type,
      approvedAmount: claim.approved_amount ?? claim.amount,
      sumInsured: policy.sum_insured,
      alreadySettled: settledOnPolicy(policy.id),
    });
    const payout = await ctx.services.payments.payout({ claimId, amount: settlement.payableAmount, actorId: user.id });
    const customer = db.get('SELECT name FROM customers WHERE id = ?', claim.customer_id);
    const fmt = (n) => `INR ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const doc = ctx.services.documents.generateSignedPdf({
      kind: 'SETTLEMENT',
      ownerCustomerId: claim.customer_id,
      referenceId: claim.id,
      filename: `settlement-${claim.id}.pdf`,
      title: `Claim settlement ${claim.id}`,
      lines: [
        { text: 'IWAS Insurance - Claim Settlement Letter', size: 15, bold: true },
        { text: `Claim: ${claim.id}   Policy: ${policy.policy_number}`, gap: 6 },
        `Claimant: ${customer?.name}`,
        `Claim type: ${claim.claim_type}   Incident date: ${claim.incident_date}`,
        { rule: true, gap: 4 },
        `Amount claimed:     ${fmt(claim.amount)}`,
        `Amount approved:    ${fmt(settlement.approvedAmount)}`,
        `Remaining cover:    ${fmt(settlement.remainingCover)}`,
        `Deductible:         ${fmt(settlement.deductible)}`,
        `Co-payment (${Math.round(settlement.copayRate * 100)}%):   ${fmt(settlement.copayAmount)}`,
        { text: `Amount paid:        ${fmt(settlement.payableAmount)}`, bold: true },
        `Payout reference: ${payout.reference}`,
        `Settled on ${today()}.`,
      ],
    });
    const final = { ...settlement, payoutReference: payout.reference, documentId: doc.id, settledAt: nowIso(), settledBy: user.id };
    return present(setStatus(claim.id, 'SETTLED', final));
  }

  function getAccessible(user, claimId) {
    const claim = db.get('SELECT * FROM claims WHERE id = ?', claimId);
    if (!claim) throw notFound('Claim');
    ctx.services.customers.getAccessible(user, claim.customer_id);
    return claim;
  }

  const present = (c) => {
    const policy = db.get('SELECT policy_number, coverage_type, sum_insured FROM policies WHERE id = ?', c.policy_id);
    return {
      claimId: c.id, policyId: c.policy_id, policyNumber: policy?.policy_number, coverageType: policy?.coverage_type,
      customerId: c.customer_id, customerName: db.get('SELECT name FROM customers WHERE id = ?', c.customer_id)?.name,
      claimType: c.claim_type, amount: c.amount, approvedAmount: c.approved_amount, incidentDate: c.incident_date,
      description: c.description, status: c.status, fraudScore: c.fraud_score, fraudFlags: parseJson(c.fraud_flags, []),
      settlement: parseJson(c.settlement, null), workflowInstanceId: c.workflow_instance_id,
      createdAt: c.created_at, updatedAt: c.updated_at,
    };
  };

  const router = express.Router();
  router.use(express.json({ limit: '60mb' }));

  router.post('/', requireRole('CUSTOMER', 'AGENT'), ah(async (req, res) => {
    res.status(201).json(await register(req.body || {}, req.user));
  }));

  router.get('/', (req, res) => {
    let rows;
    if (req.user.role === 'CUSTOMER') rows = db.all('SELECT cl.* FROM claims cl JOIN customers c ON c.id = cl.customer_id WHERE c.user_id = ? ORDER BY cl.created_at DESC', req.user.id);
    else if (req.user.role === 'AGENT') rows = db.all('SELECT cl.* FROM claims cl JOIN customers c ON c.id = cl.customer_id WHERE c.agent_id = ? ORDER BY cl.created_at DESC', req.user.id);
    else if (req.query.status) rows = db.all('SELECT * FROM claims WHERE status = ? ORDER BY created_at', String(req.query.status));
    else rows = db.all('SELECT * FROM claims ORDER BY created_at DESC LIMIT 500');
    res.json(rows.map(present));
  });

  router.get('/:id', (req, res) => {
    const claim = getAccessible(req.user, req.params.id);
    const staff = !['CUSTOMER', 'AGENT'].includes(req.user.role);
    const out = present(claim);
    if (!staff) { delete out.fraudFlags; delete out.fraudScore; }
    res.json({
      ...out,
      documents: db.all('SELECT d.id, d.filename, d.mime, d.size, d.created_at FROM documents d JOIN claim_documents cd ON cd.document_id = d.id WHERE cd.claim_id = ?', claim.id),
      tasks: staff ? db.all('SELECT id, name, candidate_group, status, outcome, comment, completed_by, created_at, completed_at FROM workflow_tasks WHERE business_key = ? ORDER BY created_at', claim.id) : undefined,
      timeline: db.all("SELECT ts, action FROM audit_log WHERE entity = 'claim' AND entity_id = ? ORDER BY seq", claim.id),
    });
  });

  router.post('/:id/documents', requireRole('CUSTOMER', 'AGENT'), (req, res) => {
    const claim = getAccessible(req.user, req.params.id);
    if (['SETTLED', 'REJECTED'].includes(claim.status)) throw conflict('CLAIM_CLOSED', 'Claim is closed');
    const ids = attachDocuments(claim, decodeDocuments(req.body?.documents));
    audit.record(req.user.id, 'CLAIM_DOCUMENTS_ADDED', 'claim', claim.id, { count: ids.length });
    res.status(201).json({ documentIds: ids });
  });

  // Adjuster/senior decision on the claim's current workflow task.
  router.post('/:id/decision', requireRole('ADJUSTER', 'ADMIN'), (req, res) => {
    const claim = db.get('SELECT * FROM claims WHERE id = ?', req.params.id);
    if (!claim) throw notFound('Claim');
    const task = ctx.services.workflow.openTasksFor(claim.id).find((t) => t.candidate_group === req.user.role);
    if (!task) throw forbidden('No open task on this claim for your role');
    const { outcome, approvedAmount, comment } = req.body || {};
    const variables = {};
    if (approvedAmount !== undefined && approvedAmount !== null && approvedAmount !== '') {
      const amt = Number(approvedAmount);
      if (!Number.isFinite(amt) || amt < 0 || amt > claim.amount) throw badRequest('approvedAmount must be between 0 and the claimed amount');
      variables.approvedAmount = round2(amt);
    }
    const result = ctx.services.workflow.completeTask(task.id, req.user, { outcome, comment, variables });
    res.json({ workflow: result, claim: present(db.get('SELECT * FROM claims WHERE id = ?', claim.id)) });
  });

  router.post('/:id/settle', requireRole('ADJUSTER'), ah(async (req, res) => {
    res.json(await settle(req.params.id, req.user));
  }));

  return { register, settle, present, CLAIM_TYPES, router };
};

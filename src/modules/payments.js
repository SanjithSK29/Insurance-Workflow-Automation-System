// Payment Service: premium collection, claim payouts and GST invoices
// (IWA-F010 trigger, IWA-F-013). Card data never reaches IWAS: the client
// sends a gateway token (Razorpay/Stripe style), keeping PCI-DSS scope small.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { ah, round2, today } = require('../core/util');
const { retry } = require('../core/resilience');
const { requireRole } = require('../security/middleware');
const { badRequest, notFound, conflict, ApiError } = require('../core/errors');

class GatewayError extends Error {
  constructor(message, { transient = false, code = 'DECLINED' } = {}) {
    super(message);
    this.transient = transient;
    this.code = code;
  }
}

// Sandbox gateway adapter. Test tokens:
//   tok_success  -> captured
//   tok_decline  -> card declined
//   tok_flaky    -> first attempt times out, retry succeeds
function createGateway() {
  const flakyCalls = new Map();
  return {
    async charge({ amount, token, idempotencyKey }) {
      if (!Number.isFinite(amount) || amount <= 0) throw new GatewayError('Invalid amount');
      if (token === 'tok_decline') throw new GatewayError('Card declined by issuer');
      if (token === 'tok_flaky') {
        const n = (flakyCalls.get(idempotencyKey) || 0) + 1;
        flakyCalls.set(idempotencyKey, n);
        if (n === 1) throw new GatewayError('Gateway timeout', { transient: true, code: 'TIMEOUT' });
      } else if (token !== 'tok_success') {
        throw new GatewayError('Unknown payment token');
      }
      return { reference: `PG-${idempotencyKey}` };
    },
    async payout({ amount, reference }) {
      if (!Number.isFinite(amount) || amount < 0) throw new GatewayError('Invalid payout amount');
      return { reference: `PO-${reference}` };
    },
  };
}

module.exports = function paymentsModule(ctx) {
  const { db, config, audit } = ctx;
  const gateway = createGateway();

  // Charge `total` (tax inclusive). Returns the payment row id and status.
  async function charge({ purpose, referenceId, policyId = null, total, token, actorId }) {
    const base = round2(total / (1 + config.gstRate));
    const payment = { id: newId('PAY'), base, tax: round2(total - base) };
    db.run(
      `INSERT INTO payments (id, purpose, reference_id, policy_id, amount, base_amount, tax_amount, status, created_at)
       VALUES (?,?,?,?,?,?,?, 'PENDING', ?)`,
      payment.id, purpose, referenceId, policyId, total, payment.base, payment.tax, nowIso(),
    );
    let attempts = 0;
    try {
      const result = await retry(
        () => { attempts++; return gateway.charge({ amount: total, token, idempotencyKey: payment.id }); },
        { attempts: 3, baseMs: 20, isRetryable: (e) => e.transient },
      );
      db.run("UPDATE payments SET status = 'CAPTURED', gateway_ref = ?, attempts = ? WHERE id = ?", result.reference, attempts, payment.id);
      audit.record(actorId, 'PAYMENT_CAPTURED', 'payment', payment.id, { purpose, referenceId, amount: total, attempts });
      return { paymentId: payment.id, status: 'CAPTURED', amount: total, baseAmount: payment.base, taxAmount: payment.tax, gatewayRef: result.reference };
    } catch (err) {
      db.run("UPDATE payments SET status = 'FAILED', attempts = ?, failure_reason = ? WHERE id = ?", attempts, err.message, payment.id);
      audit.record(actorId, 'PAYMENT_FAILED', 'payment', payment.id, { purpose, referenceId, reason: err.message });
      throw new ApiError(402, 'PAYMENT_FAILED', err.message, { paymentId: payment.id });
    }
  }

  // GST invoice with CGST/SGST breakup (IWA-F-013).
  function generateInvoice(paymentId, { customerId, policyNumber, description }) {
    const p = db.get('SELECT * FROM payments WHERE id = ?', paymentId);
    const customer = db.get('SELECT name FROM customers WHERE id = ?', customerId);
    const half = round2(p.tax_amount / 2);
    const fmt = (n) => `INR ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const doc = ctx.services.documents.generateSignedPdf({
      kind: 'INVOICE',
      ownerCustomerId: customerId,
      referenceId: paymentId,
      filename: `invoice-${paymentId}.pdf`,
      title: `Tax Invoice ${paymentId}`,
      lines: [
        { text: 'IWAS Insurance - TAX INVOICE', size: 16, bold: true },
        { text: `Invoice No: INV-${paymentId}`, gap: 6 },
        `Invoice Date: ${today()}`,
        `Billed To: ${customer?.name ?? customerId}`,
        `Policy: ${policyNumber}`,
        `Description: ${description}`,
        { rule: true, gap: 6 },
        { text: 'Premium breakup', bold: true, gap: 4 },
        `Taxable premium:            ${fmt(p.base_amount)}`,
        `CGST @ ${(config.gstRate * 50).toFixed(0)}%:                 ${fmt(half)}`,
        `SGST @ ${(config.gstRate * 50).toFixed(0)}%:                 ${fmt(round2(p.tax_amount - half))}`,
        { text: `Total paid:                 ${fmt(p.amount)}`, bold: true },
        { text: `Payment reference: ${p.gateway_ref}`, gap: 6 },
        'SAC 997133 - Life/Non-life insurance services',
      ],
    });
    db.run('UPDATE payments SET invoice_document_id = ? WHERE id = ?', doc.id, paymentId);
    return doc;
  }

  async function payout({ claimId, amount, actorId }) {
    const result = await retry(() => gateway.payout({ amount, reference: claimId }), { attempts: 3, baseMs: 20 });
    audit.record(actorId, 'CLAIM_PAYOUT', 'claim', claimId, { amount, reference: result.reference });
    return result;
  }

  const present = (r) => ({
    paymentId: r.id, purpose: r.purpose, referenceId: r.reference_id, policyId: r.policy_id, amount: r.amount,
    baseAmount: r.base_amount, taxAmount: r.tax_amount, status: r.status, attempts: r.attempts,
    failureReason: r.failure_reason, invoiceDocumentId: r.invoice_document_id, createdAt: r.created_at,
  });

  const router = express.Router();

  // Pay the premium for an approved application -> policy issued (IWA-F-010).
  router.post('/', requireRole('CUSTOMER', 'AGENT'), ah(async (req, res) => {
    const { applicationId, paymentToken } = req.body || {};
    if (!applicationId || !paymentToken) throw badRequest('applicationId and paymentToken are required');
    const app = db.get('SELECT * FROM applications WHERE id = ?', applicationId);
    if (!app) throw notFound('Application');
    ctx.services.customers.getAccessible(req.user, app.customer_id);
    if (app.status === 'ISSUED') throw conflict('ALREADY_ISSUED', 'Policy already issued for this application');
    if (app.status !== 'APPROVED') throw conflict('NOT_APPROVED', `Application is ${app.status}; payment is only possible once approved`);
    const kyc = db.get('SELECT kyc_status FROM customers WHERE id = ?', app.customer_id).kyc_status;
    if (kyc !== 'VERIFIED') throw conflict('KYC_REQUIRED', 'KYC must be verified before policy issuance');

    const quote = db.get('SELECT * FROM quotes WHERE id = ?', app.quote_id);
    const payment = await charge({ purpose: 'NEW_POLICY', referenceId: app.id, total: quote.premium, token: paymentToken, actorId: req.user.id });
    const policy = ctx.services.policies.issue(app, payment.paymentId, req.user.id);
    const invoice = generateInvoice(payment.paymentId, { customerId: app.customer_id, policyNumber: policy.policyNumber, description: `${quote.coverage_type} insurance premium, ${quote.term} year(s)` });
    res.status(201).json({ ...payment, invoiceDocumentId: invoice.id, policy });
  }));

  router.get('/', (req, res) => {
    let rows;
    if (req.user.role === 'CUSTOMER') {
      rows = db.all(`SELECT p.* FROM payments p LEFT JOIN applications a ON a.id = p.reference_id LEFT JOIN policies po ON po.id = p.policy_id
        JOIN customers c ON c.id = COALESCE(a.customer_id, po.customer_id) WHERE c.user_id = ? ORDER BY p.created_at DESC`, req.user.id);
    } else if (['ADMIN', 'UNDERWRITER'].includes(req.user.role)) {
      rows = db.all('SELECT * FROM payments ORDER BY created_at DESC LIMIT 500');
    } else {
      rows = [];
    }
    res.json(rows.map(present));
  });

  return { charge, payout, generateInvoice, gateway, router };
};

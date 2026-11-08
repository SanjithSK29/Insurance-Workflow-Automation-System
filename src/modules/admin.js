// Operations: dashboards (IWA-F-032), CSV/PDF reports (IWA-F-033), audit log
// access (IWA-F-034), runtime settings and scheduled jobs.
const express = require('express');
const { today, round2, isIsoDate, parseJson, daysBetween } = require('../core/util');
const { requireRole } = require('../security/middleware');
const { buildPdf } = require('./pdf');
const { badRequest, notFound } = require('../core/errors');

const REPORTS = {
  policies: {
    title: 'Policy Register',
    columns: ['policy_number', 'customer', 'coverage_type', 'sum_insured', 'premium', 'start_date', 'end_date', 'status', 'version'],
    query: (db) => db.all(`SELECT p.policy_number, c.name AS customer, p.coverage_type, p.sum_insured, p.premium, p.start_date, p.end_date, p.status, p.version
                           FROM policies p JOIN customers c ON c.id = p.customer_id ORDER BY p.created_at`),
  },
  claims: {
    title: 'Claims Register',
    columns: ['claim_id', 'policy_number', 'claim_type', 'amount', 'approved_amount', 'payable', 'status', 'fraud_score', 'created_at'],
    query: (db) => db.all(`SELECT cl.id AS claim_id, p.policy_number, cl.claim_type, cl.amount, cl.approved_amount, cl.settlement, cl.status, cl.fraud_score, cl.created_at
                           FROM claims cl JOIN policies p ON p.id = cl.policy_id ORDER BY cl.created_at`)
      .map((r) => ({ ...r, payable: parseJson(r.settlement, {})?.payableAmount ?? '' })),
  },
  payments: {
    title: 'Premium Collections',
    columns: ['id', 'purpose', 'reference_id', 'amount', 'base_amount', 'tax_amount', 'status', 'created_at'],
    query: (db) => db.all('SELECT * FROM payments ORDER BY created_at'),
  },
  renewals: {
    title: 'Renewals Due',
    columns: ['policy_number', 'customer', 'coverage_type', 'premium', 'end_date', 'days_to_expiry'],
    query: (db) => db.all(`SELECT p.policy_number, c.name AS customer, p.coverage_type, p.premium, p.end_date
                           FROM policies p JOIN customers c ON c.id = p.customer_id
                           WHERE p.status = 'ACTIVE' ORDER BY p.end_date`)
      .map((r) => ({ ...r, days_to_expiry: daysBetween(today(), r.end_date) })),
  },
};

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

module.exports = function adminModule(ctx) {
  const { db, config, audit } = ctx;

  function dashboard() {
    const count = (sql, ...p) => db.get(sql, ...p)?.n ?? 0;
    const group = (sql) => Object.fromEntries(db.all(sql).map((r) => [r.k, r.n]));
    const slaCutoff = new Date(Date.now() - config.slaHours * 3_600_000).toISOString();
    const cycle = db.get(`SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) AS h FROM claims WHERE status IN ('SETTLED','REJECTED')`)?.h;
    return {
      generatedAt: new Date().toISOString(),
      policies: {
        byStatus: group('SELECT status AS k, COUNT(*) AS n FROM policies GROUP BY status'),
        byCoverage: group("SELECT coverage_type AS k, COUNT(*) AS n FROM policies WHERE status = 'ACTIVE' GROUP BY coverage_type"),
        active: count("SELECT COUNT(*) AS n FROM policies WHERE status = 'ACTIVE'"),
        expiringIn30Days: count("SELECT COUNT(*) AS n FROM policies WHERE status = 'ACTIVE' AND end_date <= date('now', '+30 day')"),
      },
      applications: {
        byStatus: group('SELECT status AS k, COUNT(*) AS n FROM applications GROUP BY status'),
        pendingManualReview: count("SELECT COUNT(*) AS n FROM applications WHERE status = 'MANUAL_REVIEW'"),
        pendingKyc: count("SELECT COUNT(*) AS n FROM customers WHERE kyc_status = 'PENDING_MANUAL'"),
      },
      claims: {
        byStatus: group('SELECT status AS k, COUNT(*) AS n FROM claims GROUP BY status'),
        backlog: count("SELECT COUNT(*) AS n FROM claims WHERE status IN ('REGISTERED','UNDER_REVIEW','APPROVED')"),
        fraudFlagged: count('SELECT COUNT(*) AS n FROM claims WHERE fraud_score >= 50'),
        totalPaidOut: round2(db.all("SELECT settlement FROM claims WHERE status = 'SETTLED'").reduce((s, r) => s + (parseJson(r.settlement, {}).payableAmount || 0), 0)),
        avgCycleHours: cycle == null ? null : round2(cycle),
      },
      sla: {
        targetHours: config.slaHours,
        openTasks: count("SELECT COUNT(*) AS n FROM workflow_tasks WHERE status = 'OPEN'"),
        breachedTasks: count("SELECT COUNT(*) AS n FROM workflow_tasks WHERE status = 'OPEN' AND created_at < ?", slaCutoff),
        openTasksByGroup: group("SELECT candidate_group AS k, COUNT(*) AS n FROM workflow_tasks WHERE status = 'OPEN' GROUP BY candidate_group"),
      },
      finance: {
        premiumCollected: round2(db.get("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'CAPTURED'").s),
        failedPayments: count("SELECT COUNT(*) AS n FROM payments WHERE status = 'FAILED'"),
      },
      renewals: {
        overdue: count("SELECT COUNT(*) AS n FROM policies WHERE status = 'ACTIVE' AND end_date < date('now')"),
        renewalWindowOpen: count("SELECT COUNT(*) AS n FROM policies WHERE status = 'ACTIVE' AND end_date >= date('now') AND end_date <= date('now', '+60 day')"),
      },
    };
  }

  function report(type, format) {
    const def = REPORTS[type];
    if (!def) throw notFound(`Report '${type}'`);
    const rows = def.query(db);
    if (format === 'csv') {
      const lines = [def.columns.join(','), ...rows.map((r) => def.columns.map((c) => csvCell(r[c])).join(','))];
      return { mime: 'text/csv; charset=utf-8', filename: `${type}-${today()}.csv`, body: Buffer.from(lines.join('\r\n') + '\r\n', 'utf8') };
    }
    if (format === 'pdf') {
      const pdf = buildPdf({
        title: def.title,
        lines: [
          { text: `IWAS - ${def.title}`, size: 15, bold: true },
          `Generated ${new Date().toISOString()} - ${rows.length} record(s)`,
          { rule: true, gap: 4 },
          { text: def.columns.join(' | '), size: 8, bold: true },
          ...rows.map((r) => ({ text: def.columns.map((c) => r[c] ?? '').join(' | '), size: 8 })),
        ],
      });
      return { mime: 'application/pdf', filename: `${type}-${today()}.pdf`, body: pdf };
    }
    throw badRequest("format must be 'csv' or 'pdf'");
  }

  const router = express.Router();

  router.get('/dashboard', requireRole('ADMIN', 'UNDERWRITER', 'ADJUSTER'), (req, res) => res.json(dashboard()));

  router.get('/reports/:type', requireRole('ADMIN'), (req, res) => {
    const out = report(req.params.type, String(req.query.format || 'csv').toLowerCase());
    audit.record(req.user.id, 'REPORT_EXPORTED', 'report', req.params.type, { format: req.query.format || 'csv' });
    res.set({ 'Content-Type': out.mime, 'Content-Disposition': `attachment; filename="${out.filename}"` }).send(out.body);
  });

  router.get('/audit', requireRole('ADMIN'), (req, res) => res.json(audit.list(req.query)));
  router.get('/audit/verify', requireRole('ADMIN'), (req, res) => res.json(audit.verify()));

  router.get('/settings', requireRole('ADMIN'), (req, res) => {
    res.json({ riskThreshold: ctx.services.underwriting.riskThreshold(), reminderDays: config.reminderDays, slaHours: config.slaHours });
  });

  router.put('/settings/risk-threshold', requireRole('ADMIN'), (req, res) => {
    const value = Number(req.body?.value);
    if (!Number.isInteger(value) || value < 0 || value > 100) throw badRequest('value must be an integer 0-100');
    const old = ctx.services.underwriting.riskThreshold();
    db.run("INSERT INTO settings (key, value) VALUES ('riskThreshold', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(value));
    audit.record(req.user.id, 'SETTING_CHANGED', 'setting', 'riskThreshold', { from: old, to: value });
    res.json({ riskThreshold: value });
  });

  router.post('/jobs/renewal-reminders', requireRole('ADMIN'), (req, res) => {
    const asOf = req.body?.asOf;
    if (asOf !== undefined && !isIsoDate(asOf)) throw badRequest('asOf must be YYYY-MM-DD');
    res.json({ sent: ctx.services.policies.runRenewalReminders(asOf || today()) });
  });

  return { dashboard, report, router };
};

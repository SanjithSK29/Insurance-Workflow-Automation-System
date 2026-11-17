# Requirements Traceability Matrix (RTM)

This matrix updates SRS §8 and STP §13 with the implementation and test results.
Status: **P** = passed, **A** = automated check in CI, **M** = manual / environment-dependent verification.
Last run (17-11-2026): `npm test` on Node.js 25.2.0 (Windows 11): **114 tests, 114 passed, 0 failed**. CI re-runs the suite on Node.js 22 for every push and pull request.
Coverage (`npm run test:coverage`, c8 with `--all`): **94.3 % statements, 80.98 % branches, 93.53 % functions, 94.3 % lines**; CI fails below 93 / 80 / 92 / 93. Details: [Code Coverage Report](reports/CODE_COVERAGE_REPORT.md), [Branch Coverage Report](reports/BRANCH_COVERAGE_REPORT.md). Defects: [Defect Log](reports/DEFECT_LOG.md). Deviations: [DEVIATIONS.md](DEVIATIONS.md).

## Functional requirements

| Req ID | Requirement | Module / code | Test case(s) | Test file | Status |
| --- | --- | --- | --- | --- | --- |
| IWA-F-001 | Personalised quote within 10 s | `src/modules/quotes.js` | TC-Quote-01, TC-Quote-02 | quote-underwriting.test.js | P |
| IWA-F-002 | Risk score 0–100; high risk flagged for manual review | `src/modules/underwriting.js` | TC-UW-01 (×2), threshold config | quote-underwriting.test.js | P |
| IWA-F-003 | KYC verified before issuance | `src/modules/customers.js`, `payments.js` | TC-KYC-01, manual-queue fallback | quote-underwriting.test.js | P |
| IWA-F-010 | Signed digital policy PDF after payment | `src/modules/policies.js`, `documents.js`, `pdf.js` | TC-Policy-01, TC-Policy-02 | policy.test.js | P |
| IWA-F-011 | Renewal with reminders at 30/15/7 days | `policies.js` (`runRenewalReminders`), `server.js` scheduler | TC-Renew-01, renewal payment | policy.test.js | P |
| IWA-F-012 | Endorsement with audit trail | `policies.js` (`endorse`) | TC-Endorse-01 | policy.test.js | P |
| IWA-F-013 | Invoice PDF with tax breakup | `payments.js` (`generateInvoice`) | TC-Invoice-01 | policy.test.js | P |
| IWA-F-014 | Policy cancellation with pro-rata refund | `policies.js` (`cancel`), `payments.js` (`refund`), `documents.js` (cancellation letter) | TC-Cancel-01, TC-Cancel-02 | policy-cancellation.test.js | P |
| IWA-F-020 | Claim registration with document upload (10 MB) | `src/modules/claims.js` | TC-Claim-01 – TC-Claim-11, TC-Contract-01 – 05, TC-Date-01 – 03, TC-Sec-Claim-04 – 06 | claims-workflow, claims-edge-cases, claims-contract, date-validation, claims-security | P |
| IWA-F-021 | Configurable multi-level BPMN approval | `src/workflow/*`, `claim-approval.bpmn` | TC-WF-01 – TC-WF-03, TC-Sec-Claim-07 | claims-workflow, claims-edge-cases, claims-security | P |
| IWA-F-022 | Automated fraud detection | `src/modules/fraud.js` | TC-Fraud-01 – TC-Fraud-11 | claims-workflow.test.js, fraud-settlement.test.js | P |
| IWA-F-023 | Settlement per policy terms | `src/modules/settlement.js`, `claims.js` (`settle`) | TC-Settle-01 – TC-Settle-13 | claims-workflow, fraud-settlement, claims-edge-cases, settlement-letter | P |
| IWA-F-024 | Notify claimant at every status change | `src/modules/notifications.js`, `claims.js` | TC-Notify-01 – TC-Notify-12, TC-Track-01 – 05 | claims-workflow, notifications, notifications-resilience, claim-tracking | P |
| IWA-F-030 | Admin UI to design and deploy BPMN | `workflow/engine.js` admin routes, `public/app.js` (Workflows) | TC-Admin-01, TC-WF-02 | admin-security.test.js | P |
| IWA-F-031 | RBAC for all modules | `src/security/middleware.js`, per-module access checks | TC-RBAC-01, TC-Sec-Claim-01 – 02 (claims RBAC matrix) | admin-security.test.js, claims-security.test.js | P |
| IWA-F-032 | Dashboards load in under 3 s | `src/modules/admin.js` (`dashboard`) | TC-Dash-01 | admin-security.test.js | P |
| IWA-F-033 | CSV and PDF report export | `admin.js` (`report`) | TC-Report-01 | admin-security.test.js | P |
| IWA-F-034 | Immutable audit log | `src/security/audit.js`, DB triggers in `core/db.js` | TC-Audit-01 | admin-security.test.js | P |

## Non-functional and security requirements

| Req ID | Requirement | Implementation | Test case(s) | Status |
| --- | --- | --- | --- | --- |
| IWA-NF-001 | p95 ≤ 2 s for quote and claim-status APIs | Lightweight handlers, prepared-statement cache, indexes | TC-Perf-01 (400 requests in-process), `perf/quote-load.js` (k6: quote and claim status, deployed env) | P / M |
| IWA-NF-002 | 99.9 % availability | Health endpoint, Docker `HEALTHCHECK`, stateless app (horizontally scalable), circuit breakers on vendors; notification failures cannot crash the process (DEF-01 fix) | CI container health check, TC-Notify-10 – 12 | A / M (needs production monitoring) |
| IWA-NF-003 | AES-256 at rest, TLS 1.2+ in transit | `security/crypto.js` (AES-256-GCM), `server.js` (`minVersion: TLSv1.2`) | TC-Sec-01, TC-Sec-TLS-01 | P |
| IWA-NF-004 | Audit retention 7 years, immutable | Append-only triggers + hash chain; no delete path in code | TC-Audit-01 | P (retention = ops policy, M) |
| IWA-NF-005 | WCAG 2.1 AA | Labels, skip link, focus outlines, `aria-live` toasts, contrast-checked palette, keyboard-only flows | Manual audit (axe / Lighthouse) | M |
| IWA-SR-001 | TLS 1.2+ mandatory | HTTPS server option, HSTS header | TC-Sec-TLS-01 | P |
| IWA-SR-002 | MFA for admin and underwriter | TOTP (RFC 6238) in `security/auth.js`, enforced in `users.js` | TC-Sec-MFA-01 | P |
| IWA-SR-003 | PII masked in logs and UI | `security/pii.js`, `core/logger.js`, audit redaction | TC-Sec-PII-01, TC-Sec-Claim-03 | P |
| IWA-SR-004 | Rate limiting and throttling | `rateLimit` middleware (stricter on public routes) | TC-Sec-RL-01 | P |
| IWA-SR-005 | Digitally signed policy and settlement documents | Ed25519 in `documents.js` | TC-Sec-Sign-01, TC-Policy-01, TC-Settle-01, TC-Settle-10 – 12 | P |

## Additional automated checks

| Area | Test |
| --- | --- |
| BPMN condition evaluator (no `eval`; rejects code) | performance-unit.test.js |
| BPMN structural validation (start/end, reachability, candidate groups) | performance-unit.test.js |
| Circuit breaker open → half-open → closed | performance-unit.test.js |
| Retry with exponential backoff | performance-unit.test.js |
| PDF writer validity (multi-page, xref offset) | performance-unit.test.js |
| Actuarial outage → 503, quote reuse blocked, transient payment retry | quote-underwriting / policy tests |
| Claims fallbacks: document type sniffing, filename sanitising, role-scoped listing, event consumers | claims-edge-cases.test.js |
| Notification channel selection, provider outage and retry, role broadcast, inbox | notifications.test.js |
| SAD §4.4 error envelope and trace ids on every claims error | claims-contract.test.js |
| STP §5.1 injection and path-traversal fuzzing on claim inputs | claims-security.test.js |
| Coverage gate (statements 93 %, branches 80 %, functions 92 %, lines 93 %) | `.c8rc.json`, CI job "Coverage report (c8)" |

## Clarified behaviour found during testing

| Item | Behaviour | Test |
| --- | --- | --- |
| Remaining cover after a settlement | Reduced by the amount actually **paid** (after deductible and co-pay), not by the amount claimed. Example: sum insured 100,000; a 90,000 health claim pays 76,500, so 23,500 of cover remains and the next claim is capped at 23,500. | TC-Settle-04, TC-Settle-09 |
| EXCEEDS_REMAINING_COVER on its own | Scores 30, below the flag threshold of 50, so it routes to fraud investigation only when another rule also fires (e.g. EARLY_CLAIM). | TC-Fraud-05, TC-Settle-09 |
| Claims without documents | Accepted (evidence can be added later with `POST /claims/{id}/documents`) but scored NO_SUPPORTING_DOCUMENTS. | TC-Claim-06, TC-Claim-09 |

## STP exit criteria

| Criterion (STP §5) | Result |
| --- | --- |
| 100 % of planned automated test cases executed | 114 / 114 executed, 114 passed |
| 0 critical defects open | 0 open (3 found this cycle: 1 High, 1 Medium, 1 Low; all fixed and re-tested) |
| All high-priority acceptance criteria met | All high-priority F- and SR- requirements are P |
| Items that need a deployed environment | NF-002 uptime, NF-005 accessibility audit, k6 load test, OWASP ZAP scan: planned for UAT |

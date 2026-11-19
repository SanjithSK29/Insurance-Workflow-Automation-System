# Requirements Traceability Matrix (RTM)

This matrix updates SRS §8 and STP §13 with the implementation and test results.
Status: **P** = passed, **A** = automated check in CI, **M** = manual / environment-dependent verification.
Last run (19-11-2026, after the Sprint 4 fixes on branch `samarth-fix-main`): `npm test` on Node.js 22.19.0 (Windows 11): **170 tests, 170 passed, 0 failed** (122 at the end of the QA cycle, 154 after the Developer Lead cycle). CI re-runs the suite on Node.js 22 for every push and pull request.
Coverage (`npm run test:coverage`, c8 with `--all`): **96.46 % statements, 85.81 % branches, 95.10 % functions, 96.46 % lines** (QA cycle: 94.68 / 82.18 / 93.53 / 94.68); CI fails below 93 / 80 / 92 / 93. Details: [Code Coverage Report](reports/CODE_COVERAGE_REPORT.md), [Branch Coverage Report](reports/BRANCH_COVERAGE_REPORT.md). Defects: [Defect Log](reports/DEFECT_LOG.md). Deviations: [DEVIATIONS.md](DEVIATIONS.md).

## Functional requirements

| Req ID | Requirement | Module / code | Test case(s) | Test file | Status |
| --- | --- | --- | --- | --- | --- |
| IWA-F-001 | Personalised quote within 10 s | `src/modules/quotes.js` | TC-Quote-01, TC-Quote-02, TC-Quote-06/07 (numeric input, DEF-04) | quote-underwriting, numeric-input | P |
| IWA-F-002 | Risk score 0–100; high risk flagged for manual review | `src/modules/underwriting.js` | TC-UW-01 (×2), threshold config, TC-Admin-02 (threshold input, DEF-07) | quote-underwriting, numeric-input | P |
| IWA-F-003 | KYC verified before issuance | `src/modules/customers.js`, `payments.js` | TC-KYC-01, manual-queue fallback, TC-KYC-03/04 (income input, DEF-05) | quote-underwriting, numeric-input | P |
| IWA-F-010 | Signed digital policy PDF after payment | `src/modules/policies.js`, `payments.js` (one payment at a time, DEF-08), `documents.js`, `pdf.js` (accented names, DEF-12) | TC-Policy-01..04, TC-Pay-03/05/06, TC-Doc-01/02, TC-PDF-03..05 | policy, payments-hardening, documents-pdf, policies-payments-edge-cases | P |
| IWA-F-011 | Renewal with reminders at 30/15/7 days | `policies.js` (`runRenewalReminders`, `renew` under the payment lock), `server.js` scheduler | TC-Renew-01..04, TC-Pay-04 (double renewal, DEF-08) | policy, payments-hardening, policies-payments-edge-cases | P |
| IWA-F-012 | Endorsement with audit trail | `policies.js` (`endorse`: premium difference charged or refunded, DEF-09; text fields, DEF-11) | TC-Endorse-01..06 | policy, numeric-input, endorsement-cancellation, policies-payments-edge-cases | P |
| IWA-F-013 | Invoice PDF with tax breakup | `payments.js` (`generateInvoice`, also for paid endorsements) | TC-Invoice-01, TC-Endorse-03 | policy, endorsement-cancellation | P |
| IWA-F-014 | Policy cancellation with pro-rata refund | `policies.js` (`cancel`, `unusedPremium` per paid period, DEF-10), `payments.js` (`refund`), `documents.js` (cancellation letter), web UI cancel form | TC-Cancel-01..05 | policy-cancellation, endorsement-cancellation | P |
| IWA-F-015 | Policy reinstatement within 30-day grace period | `policies.js` (`reinstate`, payment lock, 500 fee, health attestation), `reinstatements` table | TC-Reinstate-03..06 | policy-reinstatement | P |
| IWA-F-016 | Policy cancellation preview quote | `policies.js` (`cancellationQuote`, breakdown of gross refund, charge, net refund) | TC-Reinstate-01..02 | policy-reinstatement | P |
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
| IWA-NF-005 | WCAG 2.1 AA | Labels, skip link, focus ring, `aria-live` toasts, keyboard-only flows; colour tokens meet 4.5:1 / 3:1 in both themes (DEF-13) | TC-UX-01..04: axe-core WCAG A/AA rules on every screen of every role, plus a contrast check; screen-reader walk-through at UAT | P (automated) / M (screen reader) |
| IWA-SR-001 | TLS 1.2+ mandatory | HTTPS server option, HSTS header | TC-Sec-TLS-01 | P |
| IWA-SR-002 | MFA for admin and underwriter | TOTP (RFC 6238) in `security/auth.js`, enforced in `users.js` | TC-Sec-MFA-01 | P |
| IWA-SR-003 | PII masked in logs and UI | `security/pii.js`, `core/logger.js`, audit redaction | TC-Sec-PII-01, TC-Sec-Claim-03 | P |
| IWA-SR-004 | Rate limiting and throttling | `rateLimit` middleware (stricter on public routes) | TC-Sec-RL-01 | P |
| IWA-SR-005 | Digitally signed policy and settlement documents | Ed25519 in `documents.js` | TC-Sec-Sign-01, TC-Policy-01, TC-Settle-01, TC-Settle-10 – 12 | P |
| IWA-SR-006 | User-submitted text can never run as markup | Text stored as written (DEF-16) and rendered as plain text by the web UI (`textContent`) and PDFs; JSON API with `nosniff` and a strict CSP | TC-Sec-XSS-01, TC-Sec-XSS-02, TC-Sec-Claim-04 | sprint4-security-fraud, ui-accessibility, claims-security | P |
| IWA-F-025 | Adjuster claims register export with status and coverage filtering | `admin.js` (`report`), RBAC extension for adjuster | TC-Report-02 | sprint4-security-fraud | P |

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
| Shared numeric input rule `parseNumber()` (DEF-03..07) | numeric-input.test.js |
| Coverage gate (statements 93 %, branches 80 %, functions 92 %, lines 93 %) | `.c8rc.json`, CI job "Coverage report (c8)" |
| Web UI logout revokes the token server-side (DEF-14; SR-002, F-031) | ui-accessibility.test.js (TC-UX-05) |

## Clarified behaviour found during testing

| Item | Behaviour | Test |
| --- | --- | --- |
| Remaining cover after a settlement | Reduced by the amount actually **paid** (after deductible and co-pay), not by the amount claimed. Example: sum insured 100,000; a 90,000 health claim pays 76,500, so 23,500 of cover remains and the next claim is capped at 23,500. | TC-Settle-04, TC-Settle-09 |
| EXCEEDS_REMAINING_COVER on its own | Scores 30, below the flag threshold of 50, so it routes to fraud investigation only when another rule also fires (e.g. EARLY_CLAIM). | TC-Fraud-05, TC-Settle-09 |
| Claims without documents | Accepted (evidence can be added later with `POST /claims/{id}/documents`) but scored NO_SUPPORTING_DOCUMENTS. | TC-Claim-06, TC-Claim-09 |

## STP exit criteria

| Criterion (STP §5) | Result |
| --- | --- |
| 100 % of planned automated test cases executed | 170 / 170 executed, 170 passed |
| 0 critical defects open | 0 open (16 found: 4 High, 8 Medium, 4 Low; all fixed and re-tested) |
| All high-priority acceptance criteria met | All high-priority F- and SR- requirements are P |
| Items that need a deployed environment | NF-002 uptime, k6 load test, OWASP ZAP scan, NF-005 screen-reader walk-through: planned for UAT (the automated WCAG checks now run in CI) |

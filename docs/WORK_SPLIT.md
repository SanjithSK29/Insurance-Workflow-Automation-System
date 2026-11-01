# Team Work Split

How the IWAS implementation is divided among the four team members. Ownership follows each person's role in the STP (§9 Roles and Responsibilities) and the bounded contexts in the SAD (§3.4), so each member owns a complete slice: code, the tests for it, and its part of the documentation.

| Member | Role | Owns | Requirements |
| --- | --- | --- | --- |
| Sanjith Suresh Kumar | Project Lead | Quotes, underwriting, KYC, workflow engine, integration | F-001, F-002, F-003, F-021, F-030 |
| Samarth A | Developer Lead | Policies, payments, invoices, documents/PDF, web UI | F-010, F-011, F-012, F-013, UX (3.1) |
| Sakaray Vishal | QA Lead | Claims, fraud detection, settlement, notifications, test suite and RTM | F-020, F-022, F-023, F-024, STP execution |
| Sampreeth Jaladi | DevOps / Security Engineer | Auth/MFA, RBAC, audit, encryption, PII masking, dashboards/reports, CI/CD, Docker | F-031 – F-034, NF-003/004, SR-001 – SR-005 |

---

## 1. Sanjith Suresh Kumar: Project Lead

**Modules**
- `src/modules/quotes.js`: Quote Service and actuarial premium engine (rates, age bands, tobacco loading, multi-year discount, GST)
- `src/modules/underwriting.js`: rule-engine risk scoring 0–100, manual review queue, configurable threshold
- `src/modules/customers.js`: customer onboarding (single and agent bulk), KYC adapter with circuit breaker and manual KYC queue
- `src/workflow/` (`bpmn.js`, `expression.js`, `engine.js`, `claim-approval.bpmn`): BPMN 2.0 parser/validator, safe condition evaluator, workflow runtime, versioned deployments
- `src/app.js`: integration of all modules behind the API gateway

**Tests:** `test/quote-underwriting.test.js` (TC-Quote-01/02, TC-UW-01, TC-KYC-01), BPMN/expression unit tests in `test/performance-unit.test.js`

**Docs:** SRS sections 4.1 and 4.4, SAD architecture (§3), sign-off on the RTM

## 2. Samarth A: Developer Lead

**Modules**
- `src/modules/policies.js`: issuance, policy numbering, renewal and renewal quote, 30/15/7-day reminder job, endorsements with pro-rata premium
- `src/modules/payments.js`: payment gateway adapter (tokens, retry on transient failures), GST invoices with CGST/SGST, claim payouts
- `src/modules/documents.js` and `src/modules/pdf.js`: document store, PDF writer, Ed25519 signing and verification
- `public/` (`index.html`, `app.js`, `styles.css`): role-based web UI for customer, agent, underwriter, adjuster and admin, plus accessibility and English/Hindi labels
- `src/seed.js`: demo data

**Tests:** `test/policy.test.js` (TC-Policy-01/02, TC-Renew-01, TC-Endorse-01, TC-Invoice-01), PDF unit test

**Docs:** SAD sequence diagrams (policy purchase), README "What it does" and "API overview"; code review for all pull requests (STP §9)

## 3. Sakaray Vishal: QA Lead

**Modules**
- `src/modules/claims.js`: claim registration, document validation (type sniffing, 10 MB limit), workflow integration, decisions, settlement letter
- `src/modules/fraud.js`: fraud rules (duplicate, cover ratio, early claim, frequency, missing documents, late reporting)
- `src/modules/settlement.js`: settlement formula per coverage type (deductible, co-pay, remaining cover)
- `src/modules/notifications.js`: in-app, email and SMS notifications with retry

**Tests**
- `test/claims-workflow.test.js` (TC-Claim-01/02, TC-WF-01/02, TC-Fraud-01, TC-Settle-01, TC-Notify-01)
- `test/performance-unit.test.js` (TC-Perf-01) and `perf/quote-load.js` (k6)
- `test/helpers.js`: shared test harness

**Docs:** STP, `docs/TRACEABILITY.md` (RTM and exit criteria), test summary report, defect triage

## 4. Sampreeth Jaladi: DevOps / Security Engineer

**Modules**
- `src/security/auth.js`: scrypt password hashing, JWT, TOTP MFA
- `src/security/middleware.js`: authentication, RBAC, rate limiting, trace ids, security headers (HSTS, CSP)
- `src/security/crypto.js`: AES-256-GCM encryption of PII at rest
- `src/security/pii.js`: PII masking and log redaction
- `src/security/audit.js`: hash-chained, append-only audit log and verification
- `src/modules/users.js`: login, registration, admin user management
- `src/modules/admin.js`: dashboards with SLA metrics, CSV/PDF reports, settings, job triggers
- `src/core/`: config, DB schema, logger, event bus, retry and circuit breaker
- `src/server.js`: HTTPS with TLS 1.2 minimum, scheduler
- `.github/workflows/ci-cd-pipeline.yaml`, `Dockerfile`, `.env.example`

**Tests:** `test/admin-security.test.js` (TC-Admin-01, TC-RBAC-01, TC-Dash-01, TC-Report-01, TC-Audit-01, TC-Sec-01, TC-Sec-MFA-01, TC-Sec-PII-01, TC-Sec-RL-01, TC-Sec-Sign-01, TC-Sec-TLS-01)

**Docs:** SAD security architecture (STRIDE, §3.9), deployment and configuration sections of the README

---

## Shared responsibilities

| Activity | Lead | Support |
| --- | --- | --- |
| Integration and release sign-off | Sanjith | All |
| Code review (every PR needs one reviewer) | Samarth | Rotating |
| Test execution and defect triage | Vishal | Module owner fixes |
| CI/CD and environments | Sampreeth | – |
| Demo / viva walkthrough | Sanjith (overview), then each member demos their module | All |

## Suggested demo order (about 10 minutes)

1. **Sanjith:** architecture, then a customer gets a quote and applies. KYC passes and the rule engine auto-approves.
2. **Samarth:** pay with a sandbox token, the policy PDF is issued, verify its signature, show the invoice, endorse the nominee, show renewal.
3. **Vishal:** file a claim with a document, show the progress tracker, file a duplicate (fraud flag), the adjuster approves, senior approval for a high-value claim, settle, show notifications. Run `npm test`.
4. **Sampreeth:** admin login with MFA, RBAC denial, audit chain verification, dashboard, CSV/PDF export, CI pipeline on GitHub.

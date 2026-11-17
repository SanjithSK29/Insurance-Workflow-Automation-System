# Software Test Plan (STP), version 1.1

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Version | 1.1 (updates v1.0, `STP - Insurance Workflow Automation System.pdf` in the repository root) |
| Authors | Sakaray Vishal (QA Lead), Sanjith Suresh Kumar, Samarth A, Sampreeth Jaladi |
| Date | 17-11-2026 |
| Status | Draft for review (Developer Lead) |

## Revision history

| Version | Date | Author | Change summary |
| --- | --- | --- | --- |
| 1.0 | 31-08-2025 | Sakaray Vishal | Initial test plan (submitted in Part-1) |
| 1.1 | 17-11-2026 | Sakaray Vishal | Brought in line with what was built in Sprints 1–2 and what was tested in Part-3: scope (§3), tools and environment (§5, §6), schedule (§7), deliverables (§8), traceability (§13) and metrics (§14). Sections 1, 2, 4, 9–12 and 15 are unchanged apart from small additions marked *(1.1)*. |

## 1. Introduction

**Purpose:** Defines the test plan for IWAS v1.0: objectives, scope, strategy, resources, schedule and responsibilities.

**Scope:** Quote generation, underwriting and KYC, policy issuance, renewal, endorsement and cancellation, payments and invoices, claims processing, fraud detection, settlement, workflow orchestration, notifications, admin, RBAC, audit and security. Core actuarial model internals and third-party vendor systems are excluded.

**References:** IWAS SRS v1.0, SAD v1.0, IRDAI standards, PCI-DSS; *(1.1)* [RTM](TRACEABILITY.md), [Test Case Document v2.1](TEST_CASES.md), [Deviations](DEVIATIONS.md).

**Definitions:** IWAS, KYC, BPMN, RTM, SLA, CI/CD, UAT; *(1.1)* c8 (Node.js coverage tool), p95 (95th percentile).

## 2. Test items

- Quote generation module (`src/modules/quotes.js`)
- Underwriting / risk scoring and KYC (`underwriting.js`, `customers.js`)
- Policy issuance, renewal, endorsement, cancellation (`policies.js`, `payments.js`, `documents.js`, `pdf.js`)
- Claims processing, fraud detection, settlement (`claims.js`, `fraud.js`, `settlement.js`)
- Workflow orchestration engine (`src/workflow/`)
- Notification service (`notifications.js`)
- Admin, RBAC, audit and security (`admin.js`, `users.js`, `src/security/`)

## 3. Features to be tested

*(1.1)* v1.0 listed 9 features. The sprints implemented and the RTM now tracks all of the following; every one has at least one test case.

| Feature ID | Feature |
| --- | --- |
| IWA-F-001 | Generate personalised quote within 10 s |
| IWA-F-002 | Automated risk scoring, high risk to manual review |
| IWA-F-003 | KYC verification before issuance |
| IWA-F-010 | Policy issuance with signed digital PDF |
| IWA-F-011 | Renewal with reminders at 30/15/7 days |
| IWA-F-012 | Endorsement with audit trail |
| IWA-F-013 | Invoice with tax breakup |
| IWA-F-014 | Policy cancellation with pro-rata refund *(added during the project)* |
| IWA-F-020 | Claim registration with document upload (10 MB) |
| IWA-F-021 | BPMN multi-level approval workflow |
| IWA-F-022 | Automated fraud detection |
| IWA-F-023 | Settlement per policy terms |
| IWA-F-024 | Claimant notification at every status change |
| IWA-F-030 | Admin designs and deploys BPMN workflows |
| IWA-F-031 | RBAC for all modules |
| IWA-F-032 | Dashboards in under 3 s |
| IWA-F-033 | CSV and PDF report export |
| IWA-F-034 | Immutable audit log |
| IWA-NF-001 | Quote and claim-status APIs: p95 ≤ 2 s |
| IWA-NF-002 | 99.9 % availability |
| IWA-NF-003 | AES-256 at rest, TLS 1.2+ in transit |
| IWA-NF-004 | 7-year immutable audit retention |
| IWA-NF-005 | WCAG 2.1 AA |
| IWA-SR-001..005 | TLS 1.2+, MFA, PII masking, rate limiting, signed documents |

## 4. Features not to be tested

- Core actuarial engine internals (vendor-tested)
- Third-party KYC provider internals
- Payment gateway internals
- Cloud infrastructure (AWS/Azure) internals
- *(1.1)* Real email/SMS delivery (SendGrid/Twilio): replaced by sandbox adapters; the adapters' failure behaviour is tested

## 5. Test approach / strategy

**Levels** *(1.1: tools updated to the implementation stack)*

| Level | How |
| --- | --- |
| Unit | Pure functions called directly with `node:test` (fraud rules, settlement formula, date validation, BPMN parser and expressions, resilience helpers, PDF writer) |
| Integration | Each module through its HTTP API, against a fresh in-memory SQLite database and the real neighbouring modules; external vendors replaced by swappable adapters |
| System | End-to-end business flows across modules over real HTTP (quote → KYC → underwriting → payment → policy → claim → fraud → BPMN approval → settlement → notification) |
| Acceptance | UAT with the team as business users at the final demo |

**Types:** functional; regression (whole suite on every push and pull request in GitHub Actions); performance (in-process p95 test in CI, k6 for a deployed environment); security (§5.1); usability (manual WCAG 2.1 AA audit); *(1.1)* contract tests against the SAD API design; coverage measurement with c8.

**Test-first for defects** *(1.1):* every defect is first reproduced by a failing automated test, committed, then fixed in a separate commit, so the test stays as a regression check.

**Entry criteria:** stable build on the branch under test, test data available, test cases reviewed. *(1.1)* `npm ci` succeeds and the CI pipeline is green on `main`.

**Exit criteria:** 100 % of planned test cases executed, 0 critical defects open, all acceptance criteria met. *(1.1)* Coverage at or above the CI minimums: statements 93 %, branches 80 %, functions 92 %, lines 93 %.

### 5.1 Security validation

| Item | How it is tested *(1.1)* |
| --- | --- |
| PII masking in logs and UI | TC-Sec-PII-01, TC-Sec-Claim-03 |
| TLS 1.2+ verification | TC-Sec-TLS-01; HSTS checked on the running server |
| PCI-DSS & GDPR compliance checks | By design (no card data handled, PII encrypted and masked); checklist review in UAT |
| Fuzzing on quote/claim input fields | TC-Quote-02, TC-Claim-02/03/05, TC-Contract-05, TC-Sec-Claim-04..07, TC-Date-02 |
| Penetration testing on auth and workflow APIs | Lockout, OTP replay, token revocation, forged JWTs (TC-Sec-Claim-02), workflow role checks; OWASP ZAP in UAT |
| RBAC bypass attempts | TC-RBAC-01, TC-Sec-Claim-01 (30-check matrix) |

CI also runs CodeQL, gitleaks and `npm audit` on every push.

## 6. Test environment

*(1.1: replaces the v1.0 cloud/Kubernetes assumptions, which were not used.)*

| Item | Value |
| --- | --- |
| Hardware | Developer laptops (Windows 11); GitHub-hosted Ubuntu runners for CI |
| Software | IWAS v1.0 (Node.js ≥ 22.13, Express, SQLite via `node:sqlite`, in-process event bus, in-house BPMN 2.0 engine); Docker image for the container health check |
| Tools | `node:test` + `node:assert` (unit/integration/system), c8 (coverage), k6 (load, `perf/quote-load.js`), GitHub Actions (CI/CD), GitHub pull requests (reviews and defects) |
| Test data | Synthetic customers created per test by `test/helpers.js` (one user per role, KYC-ready profiles), sandbox payment tokens (`tok_success`, `tok_decline`, `tok_flaky`), minimal PDF/PNG/JPEG evidence files |

## 7. Test schedule

| Milestone | Planned (course) | Actual |
| --- | --- | --- |
| Test plan v1.0 | Part-1 | Submitted (PR #4, 11-10-2026) |
| Sprint 1 (feature tests written with the code) | 19–23 Oct 2026 | Merged with the implementation (PR #5, 01-11-2026) |
| Sprint 2 | 26–30 Oct 2026 | Merged with the implementation (PR #5); later work PRs #6–#8 (01–11 Nov) |
| Test case updates and full test execution | 02–06 Nov 2026 | 17-11-2026 (late) |
| Test reports in `docs/` | 06 Nov 2026 | 17-11-2026 (PRs #9 and #10) |
| UAT | Final demo | Final demo |

## 8. Test deliverables

| Deliverable | Location |
| --- | --- |
| Test plan | This document (v1.1); v1.0 PDF in the repository root |
| Test cases (manual and automated) | [docs/TEST_CASES.md](TEST_CASES.md) (128 cases: 122 automated, 6 manual/environment) |
| Test scripts | `test/*.test.js` (17 files), `test/helpers.js`, `perf/quote-load.js` |
| Test data | Generated by `test/helpers.js` per test file |
| Test execution logs | [docs/reports/evidence/test-run.txt](reports/evidence/test-run.txt), CI run logs |
| Defect reports | [docs/reports/DEFECT_LOG.md](reports/DEFECT_LOG.md) |
| Test summary report | [docs/reports/TEST_SUMMARY_REPORT.md](reports/TEST_SUMMARY_REPORT.md) |
| *(1.1)* Course Part-3 reports | [Unit Test](reports/UNIT_TEST_REPORT.md), [System Validation](reports/SYSTEM_VALIDATION_REPORT.md), [Code Coverage](reports/CODE_COVERAGE_REPORT.md), [Branch Coverage](reports/BRANCH_COVERAGE_REPORT.md) |

## 9. Roles and responsibilities

| Role | Name | Responsibility |
| --- | --- | --- |
| Project Lead | Sanjith Suresh Kumar | Overall ownership, sign-off, coordination |
| QA Lead | Sakaray Vishal | Prepare plan, coordinate execution, defect triage; *(1.1)* owns the claims, fraud, settlement and notification modules and their tests, the RTM and the test reports |
| Developer Lead | Samarth A | Support defect fixes, code review, smoke builds |
| DevOps / Security Engineer | Sampreeth Jaladi | CI/CD pipeline, environment setup, security testing |

## 10. Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| Delay in stable build delivery | Request early smoke builds from dev team |
| Test environment downtime | Maintain backup environment on cloud VM; *(1.1)* tests need no shared environment (in-memory database per test file) |
| Dependency on third-party KYC / payment vendors | Engage vendor early, maintain test stubs/mocks; *(1.1)* sandbox adapters with outage, decline and timeout modes |
| BPMN workflow complexity causing test flakiness | Use deterministic test workflows + versioned BPMN files |
| *(1.1)* Coverage silently dropping as code changes | c8 thresholds enforced in CI |

## 11. Assumptions and dependencies

- KYC, payment and actuarial sandboxes are stable and available *(1.1: built into the application as adapters)*
- Test data (customers, policies, claims) is available before execution *(1.1: generated per test)*
- The CI/CD pipeline is operational before test execution starts

## 12. Suspension and resumption criteria

**Suspend testing if:** the environment is unavailable for more than 4 hours; the build is too unstable (blocks more than 30 % of test cases); a critical security vulnerability is discovered.

**Resume testing if:** blocking defects are resolved; the environment is stabilised; the security patch is applied and verified.

## 13. Test case management and traceability

The RTM ([TRACEABILITY.md](TRACEABILITY.md)) maps every SRS requirement to its module, test cases, test file and status. Test case IDs follow `TC-<Area>-<NN>` and appear in the test names, so a CI failure points straight to the requirement. Examples:

- IWA-F-001 (Quote generation) → TC-Quote-01, TC-Quote-02
- IWA-F-010 (Policy issuance) → TC-Policy-01, TC-Policy-02
- IWA-F-020 (Claim registration) → TC-Claim-01..11, TC-Contract-01..05
- IWA-F-021 (BPMN workflow) → TC-WF-01..03
- IWA-F-022 (Fraud detection) → TC-Fraud-01..11
- IWA-F-023 (Settlement) → TC-Settle-01..13
- IWA-F-024 (Notifications) → TC-Notify-01..12, TC-Track-01..05
- IWA-NF-001 (Response time) → TC-Perf-01, TC-Perf-02 (k6)
- IWA-SR-001 (TLS) → TC-Sec-TLS-01

## 14. Test metrics and reporting

**Metrics collected:** % test cases executed; % passed/failed; defect density; defect aging; requirement coverage; automation coverage; *(1.1)* statement, branch, function and line coverage.

**Reports:** every CI run (shared through GitHub Actions: test results, coverage summary, HTML coverage artifact); final [Test Summary Report](reports/TEST_SUMMARY_REPORT.md).

## 15. Approvals

| Role | Name | Signature / Date |
| --- | --- | --- |
| Project Lead | Sanjith Suresh Kumar | |
| QA Lead | Sakaray Vishal | |
| Dev Lead | Samarth A | |
| DevOps / Security | Sampreeth Jaladi | |

# System Validation Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Report | System Validation Report (Deliverables Part-3, item 2.b.ii) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Validated against | SRS v1.0 (FR, NFR, security requirements), STP v1.0 §3, §5, §5.1 |
| Build under test | Branch `vishal-input-validation` (= `main` at `b4c18dd` + PR #9 + PR #10 + PR #11, including all seven defect fixes) |
| Executed on | 17-11-2026 |
| Verdict | **Accepted for demo (re-validated 19-11-2026).** All 21 functional and 6 security requirements pass, including those added in Sprints 3–4; NF-005 is now validated automatically. Open for UAT: NF-002 uptime, the k6 load run, an OWASP ZAP scan and a screen-reader walk-through. |

## 0. Re-validation (19-11-2026)

Validated against **SRS v2.0** ([docs/ieee/SRS_v2.0.pdf](../ieee/SRS_v2.0.pdf)) on `main` at `aab6199` (PR #16) + branch `samarth-final-deliverables` (DEF-17 fix, TC-UX-06): 171 / 171 tests passed.

| Requirement group | Requirements | Result |
| --- | --- | --- |
| Functional (IWA-F) | 21: F-001..003, F-010..016, F-020..025, F-030..034 | All pass end to end (F-014, F-015, F-016, F-025 added in Sprints 3–4) |
| Security (IWA-SR) | 6: SR-001..006 | All pass (SR-006, user text never runs as markup, added in Sprint 4: TC-Sec-XSS-01/02) |
| Non-functional (IWA-NF) | 5 | NF-001 (in-process p95), NF-003, NF-004 pass; **NF-005 now automated**: axe-core WCAG A/AA rules on every screen of all five roles, contrast in both themes, no placeholder text (TC-UX-01..06); NF-002 needs production monitoring |
| End-to-end flows | Policy purchase; claim with multi-level approval and settlement | Also demonstrated on the running application in the Sprint 1 and Sprint 2 videos ([docs/videos](../videos/)) |

## 1. Purpose

Unit tests show that each module works. This report answers the system-level question: **does the running system do what the SRS asks for, end to end?** Each requirement is checked by at least one system or integration test that drives the real application over HTTP: a real Express server on a random port, a real (in-memory) SQLite database and the real BPMN engine. Where an automated test cannot prove a requirement, the gap is stated.

## 2. How the system was validated

| Level (STP §5) | How it was done in IWAS |
| --- | --- |
| Integration | API tests call one module through `/api/v1/...` with a real database and real neighbouring modules (no mocks except swappable external providers: KYC, payment gateway, email/SMS). |
| System | Business flows that cross several modules, e.g. quote → KYC → underwriting → payment → policy → claim → fraud check → BPMN approval → settlement → notification. |
| Smoke (on the running server) | `src/server.js` started on port 3999 with demo data; health, auth, validation and security headers checked with `curl`. The CI pipeline repeats a health check on every push, both for `npm start` and inside the Docker image. |
| Security (STP §5.1) | RBAC bypass attempts, PII masking, input fuzzing on claim fields, TLS minimum version, MFA, lockout, rate limiting, signed documents. CI adds CodeQL, gitleaks and `npm audit`. |
| Acceptance (UAT) | Not done yet; planned with the final demo (section 6). |

## 3. Requirement validation matrix

**P** = passed by automated system/integration tests, **M** = needs manual or deployed-environment check.

### 3.1 Functional requirements

| Req ID | Requirement (SRS) | System-level evidence | Result |
| --- | --- | --- | --- |
| IWA-F-001 | Personalised quote within 10 s | TC-Quote-01..05: valid quote with premium breakdown under 10 s, invalid input 400, actuarial outage 503, expired/reused quote refused; TC-Quote-06/07: coerced values such as `income: "0x10000"` refused (DEF-04) | P |
| IWA-F-002 | Risk score 0–100, high risk to manual review | TC-UW-01a/b, TC-UW-02: auto-approve vs manual review, admin-configurable threshold; TC-Admin-02: threshold `true` refused (DEF-07) | P |
| IWA-F-003 | KYC before issuance | TC-KYC-01/02: pass/fail before issuance; provider outage goes to manual queue and resumes; TC-KYC-03/04: profile income `true`/blank refused (DEF-05) | P |
| IWA-F-010 | Signed digital policy PDF after payment | TC-Policy-01/02: policy issued only after successful payment, PDF signature verifies | P |
| IWA-F-011 | Renewal reminders at 30/15/7 days | TC-Renew-01/02 | P |
| IWA-F-012 | Endorsement with audit trail | TC-Endorse-01; TC-Endorse-02: a hex sum insured can no longer cut cover and refund premium (DEF-06) | P |
| IWA-F-013 | Invoice PDF with tax breakup | TC-Invoice-01 | P |
| IWA-F-014 | Cancellation with pro-rata refund | TC-Cancel-01/02; TC-Claim-04 shows a cancelled policy accepts no claims | P |
| IWA-F-020 | Claim registration with document upload (10 MB) | TC-Claim-01..11: claim ID returned, 10 MB limit (413), type sniffing, ownership (403), real calendar dates only, policy status, role-scoped listing, extra documents; TC-Contract-01..05: the SAD §4.3.2 API and §4.4 error envelope | P |
| IWA-F-021 | Configurable multi-level BPMN approval | TC-WF-01..03: ≤ 100,000 adjuster only; > 100,000 adds senior step; new workflow version changes routing; wrong role cannot act; TC-Sec-Claim-07: approved amount must be a real number | P |
| IWA-F-022 | Automated fraud detection | TC-Fraud-01 (end to end: duplicate routed to fraud investigation with audit entry), TC-Fraud-02..11 (every rule), TC-Settle-09 (second claim over remaining cover routed to investigation) | P |
| IWA-F-023 | Settlement per policy terms | TC-Settle-01 (end to end with signed settlement letter), TC-Settle-02..09, TC-Settle-10 (the letter states the deductible, co-pay and amount paid) | P |
| IWA-F-024 | Notify claimant at every status change | TC-Notify-01 (REGISTERED → UNDER_REVIEW → APPROVED → SETTLED, in-app and email), TC-Notify-02..12, TC-Track-01..05 ("Track Claim Status" use case: timeline, message content, rejection, adjuster alerts) | P |
| IWA-F-030 | Admin designs and deploys BPMN | TC-Admin-01, TC-WF-02 | P |
| IWA-F-031 | RBAC for all modules | TC-RBAC-01 (every module), TC-Sec-Claim-01 (30-check claims RBAC matrix), TC-Sec-Claim-02, TC-Claim-07/08, TC-WF-03, TC-Settle-08/13, TC-Notify-09 | P |
| IWA-F-032 | Dashboards load in under 3 s | TC-Dash-01, TC-Renewal-Report-03 | P |
| IWA-F-033 | CSV and PDF report export | TC-Report-01, TC-Renewal-Report-01/02 | P |
| IWA-F-034 | Immutable audit log | TC-Audit-01: append-only, tampering detected | P |

### 3.2 Non-functional requirements

| Req ID | Requirement | Evidence | Result |
| --- | --- | --- | --- |
| IWA-NF-001 | p95 ≤ 2 s for quote and claim-status APIs | TC-Perf-01: 400 requests in-process, p95 well under 2 s. The k6 script `perf/quote-load.js` now loads both the quote and the claim-status API with a separate p95 threshold each; running it needs a deployed environment. | P (in-process) / M |
| IWA-NF-002 | 99.9 % availability | Health endpoint UP on the running server; CI checks health after `npm start` and in Docker. DEF-01 (a notification error could crash the process) was found and fixed; TC-Notify-10..12 keep it fixed. Real uptime needs production monitoring. | M |
| IWA-NF-003 | AES-256 at rest, TLS 1.2+ in transit | TC-Sec-01, TC-Sec-TLS-01 | P |
| IWA-NF-004 | 7-year immutable audit retention | TC-Audit-01 proves immutability; retention period is an operations policy | P / M |
| IWA-NF-005 | WCAG 2.1 AA | UI has labels, skip link, focus outlines and `aria-live` toasts; a formal axe/Lighthouse audit is still to do | M |

### 3.3 Security requirements and STP §5.1

| Item | Evidence | Result |
| --- | --- | --- |
| IWA-SR-001 TLS 1.2+ | TC-Sec-TLS-01; HSTS header seen on the running server | P |
| IWA-SR-002 MFA for admin and underwriter | TC-Sec-MFA-01/02, TC-Sec-Lock-01/02, TC-Sec-Revoke-01 | P |
| IWA-SR-003 PII masked in logs and UI | TC-Sec-PII-01; TC-Claim-01/08, TC-Sec-Claim-03 (fraud details hidden from customers and agents) | P |
| IWA-SR-004 Rate limiting | TC-Sec-RL-01 | P |
| IWA-SR-005 Signed documents | TC-Sec-Sign-01, TC-Policy-01, TC-Settle-01; TC-Settle-11 (settlement letter verifies with only the public key), TC-Settle-12 (changing the amount paid breaks the signature) | P |
| §5.1 RBAC bypass attempts | TC-RBAC-01, TC-Sec-Claim-01/02 (role matrix, forged and unsigned JWTs), TC-Claim-07, TC-WF-03, TC-Settle-08, TC-Notify-09 | P |
| §5.1 Fuzzing of claim/quote inputs | TC-Quote-02, TC-Claim-02/03/05, TC-WF-03, TC-Sec-Trace-01, TC-Contract-05 (malformed JSON), TC-Sec-Claim-04 (SQL/script injection), TC-Sec-Claim-05 (path traversal), TC-Sec-Claim-06/07 (coerced amounts, DEF-03), TC-Date-02 (impossible dates, DEF-02) | P |
| §5.1 Penetration testing (auth, workflow APIs) | Lockout, token revocation, OTP replay and workflow role checks automated; a full OWASP ZAP scan is still to do | P / M |
| §5.1 PCI-DSS & GDPR compliance checks | Supported by design and partly tested: no card data is handled (sandbox payment tokens only), PII is encrypted at rest (TC-Sec-01) and masked (TC-Sec-PII-01). A formal checklist review has not been done. | M |

## 4. End-to-end scenarios

These cross-module flows were run automatically through the HTTP API.

| # | Scenario | Modules crossed | Test | Result |
| --- | --- | --- | --- | --- |
| E2E-1 | Customer registers, gets a quote, passes KYC and underwriting, pays, receives a signed policy | users, customers, quotes, underwriting, payments, policies, documents | `buyPolicy()` in every claims test, TC-Policy-01 | P |
| E2E-2 | Claim filed with evidence → adjuster approves a reduced amount → settled → signed letter verifies → customer notified at each step | claims, fraud, workflow, settlement, payments, documents, notifications | TC-Settle-01, TC-Notify-01 | P |
| E2E-3 | High-value claim needs adjuster then senior approval; an adjuster cannot do the senior step | claims, workflow, RBAC | TC-WF-01 | P |
| E2E-4 | Admin deploys a new workflow version, and routing changes for the next claim | admin, workflow, claims | TC-WF-02 | P |
| E2E-5 | Duplicate claim is flagged and routed to fraud investigation with an audit entry | claims, fraud, workflow, audit | TC-Fraud-01 | P |
| E2E-6 | First claim uses most of the cover; second claim is flagged, investigated, then capped at the remaining cover | claims, fraud, workflow, settlement | TC-Settle-09 | P |
| E2E-7 | Agent onboards a customer, buys a policy and files a claim for them | customers, quotes, underwriting, payments, claims | TC-Claim-08 | P |
| E2E-8 | Customer cancels a policy, gets a pro-rata refund, and can no longer claim | policies, payments, claims | TC-Cancel-01, TC-Claim-04 | P |
| E2E-9 | A claim is registered, approved and settled while the notification service is failing; nothing crashes and every failure is logged | claims, workflow, settlement, payments, notifications | TC-Notify-12 | P |
| E2E-10 | Customer follows a claim from filing to payout: timeline, in-app and email messages with the amount, then downloads and independently verifies the signed settlement letter | claims, workflow, notifications, documents | TC-Track-01/02/05, TC-Settle-10/11 | P |

## 5. Smoke test on the running server (17-11-2026)

Server started with `PORT=3999 SEED_DEMO=true node src/server.js`:

| Check | Expected | Observed |
| --- | --- | --- |
| `GET /api/v1/health` | 200, status UP | `{"status":"UP"}` |
| `POST /api/v1/quote` with `{}` | 400 validation error | 400 |
| `GET /api/v1/claims` without a token | 401 | 401 |
| `GET /` (web UI) | 200 | 200 |
| Security headers | HSTS, CSP, frame and MIME protections | `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` present |

## 6. Open items

| Item | Requirement | Plan |
| --- | --- | --- |
| Load test with k6 against a deployed environment | NF-001 | `perf/quote-load.js` is ready (quote and claim status); run it when a deployed environment is available |
| Persist the data keys in deployments | NF-002, DEF-01 root cause | Deployment owner to require `DATA_KEY` when the database is on a volume (see the defect log) |
| Availability monitoring | NF-002 | Needs production hosting; out of scope for the course demo |
| Accessibility audit (axe / Lighthouse) | NF-005 | Manual audit during UAT |
| OWASP ZAP scan | STP §5.1 | Run against the Docker image during UAT |
| PCI-DSS & GDPR checklist review | STP §5.1 | Walk through the checklists with the DevOps/Security owner during UAT |
| User acceptance test with the team as business users | STP §5 | At the final demo |

None of these block the core use cases.

## 7. Deviations from the SRS, SAD and STP

As the FAQ allows, these are documented for the demo:

| Planned | Implemented | Impact on validation |
| --- | --- | --- |
| PostgreSQL, Kafka, Camunda, S3 (STP §6) | SQLite, in-process event bus, in-house BPMN 2.0 engine, database document store | Same behaviour through the same interfaces. Topic names match Kafka, so swapping in a broker only changes `src/core/events.js`. |
| JUnit/Jest, Selenium/Playwright, Postman | `node:test` API tests over real HTTP | Same coverage of the API; the web UI has no automated tests (it calls the same tested API) |
| Jira for defects | GitHub pull requests and reviews | Course instruction |
| Test execution 02–06 Nov 2026 | 17 Nov 2026 | Late; executed on the latest `main`, which includes all merged work (PRs #6–#8) |
| SAD §4.3.2 claim response `status: REGISTERED`, field `docs` | `UNDER_REVIEW`, field `documents` with file content | See [DEVIATIONS.md](../DEVIATIONS.md) §1; REGISTERED is still the first timeline entry |

## 8. Conclusion

All 18 functional requirements and all 5 security requirements in the RTM pass at system level. NF-001 and NF-003 pass, and NF-004 passes for immutability. NF-002, NF-005 and the full NF-001 load test need a deployed environment and are scheduled for UAT. Validation found seven defects: three in the claims area (DEF-01 High, DEF-02 Medium, DEF-03 Low) and four of the same input-coercion kind in quotes, customers, endorsements and admin settings (DEF-04 Low, DEF-05..07 Medium); all were fixed and re-tested in the same cycle. The STP exit criteria are met: 100 % of planned automated tests executed (122/122 passed), 0 critical or open defects, and all high-priority acceptance criteria met.

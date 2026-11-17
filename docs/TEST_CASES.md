# Test Case Document (updated after Sprint 1 and Sprint 2)

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Document | Test Case Document, version 2.3 (updates the test cases in STP v1.0 §3 and §13) |
| History | 2.0: 86 cases after the sprints (PR #9). 2.1: 114 cases, adds contract, security, defect-regression, settlement-letter and tracking cases (PR #10). 2.2: 122 cases, adds numeric-input cases for DEF-04..07 (PR #11). 2.3: 154 cases, adds the Developer Lead's cases for policies, payments, documents and the web UI, DEF-08..14 (branch `samarth-dev-hardening`). |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241; sections 3.2 and 3.16 extended by Samarth A (Developer Lead) |
| Reviewed by | Samarth A (Developer Lead) |
| Date | 17-11-2026 |
| Related | [STP](../STP%20-%20Insurance%20Workflow%20Automation%20System.pdf), [RTM](TRACEABILITY.md), [reports](reports/) |

## 1. What changed since STP v1.0

STP v1.0 (31-08-2025) listed 9 features to test and named 11 example test cases (TC-Quote-01/02, TC-Policy-01/02, TC-Claim-01/02, TC-WF-01/02, TC-Perf-01, TC-Sec-TLS-01). The sprints changed the scope and the tooling, so the test cases were updated as follows.

| # | Change during the sprints | Effect on test cases |
| --- | --- | --- |
| 1 | Sprint 1 and Sprint 2 implemented requirements beyond the STP §3 list: KYC (F-003), endorsement (F-012), invoices (F-013), settlement (F-023), notifications (F-024), admin BPMN designer (F-030), RBAC (F-031), dashboards (F-032), reports (F-033), audit log (F-034) and security requirements SR-001 to SR-005. | Test cases added for each (TC-KYC, TC-Endorse, TC-Invoice, TC-Settle, TC-Notify, TC-Admin, TC-RBAC, TC-Dash, TC-Report, TC-Audit, TC-Sec-*). |
| 2 | Work merged after Sprint 2 (PRs #6–#8, 01-11 to 11-11-2026) added login hardening (lockout, TOTP replay protection, logout revocation), policy cancellation with pro-rata refund (F-014) and the renewals-due report. | TC-Sec-MFA-02, TC-Sec-Lock-01/02, TC-Sec-Revoke-01, TC-Sec-Trace-01, TC-Sec-Mig-01, TC-Cancel-01/02, TC-Renewal-Report-01..03. |
| 3 | The stack changed from the STP §6 assumption (Java/JUnit/Jest, PostgreSQL, Kafka, Camunda) to Node.js, SQLite, an in-process event bus and an in-house BPMN engine. | All automated tests use Node's built-in runner (`node:test`). API tests start the real Express app on a random port and call it over HTTP, so they are integration/system tests, not mocks. |
| 4 | Testing of the QA Lead's modules (claims, fraud, settlement, notifications) showed weak branch coverage (73.95 %, 73.33 %, 66.66 %, 77.77 %). | 35 test cases added in three new files (sections 3.6–3.8). |
| 5 | Testing clarified that remaining cover is reduced by the amount **paid**, not the amount claimed. | TC-Settle-04 and TC-Settle-09 pin this behaviour (see RTM, "Clarified behaviour"). |
| 6 | The SAD (§4.3.2 Claim API, §4.4 error envelope) and STP §5.1 (RBAC bypass, fuzzing) had no direct test cases for the claims module, and the "Track Claim Status" use case (SRS §7.1) had none. | Contract, security, settlement-letter and tracking test cases added (sections 3.10, 3.12–3.14). |
| 7 | Testing found three defects (DEF-01 server crash on unreadable contact details, DEF-02 impossible dates accepted, DEF-03 coerced amounts). Each got a failing test first, then a fix. | Sections 3.9 and 3.11, and TC-Sec-Claim-06/07; see [DEFECT_LOG.md](reports/DEFECT_LOG.md). |
| 8 | A review of the other modules found the DEF-03 coercion in quotes, customer income, endorsements and the admin risk threshold (DEF-04..07). | Section 3.15 (TC-Num, TC-Quote-06/07, TC-KYC-03/04, TC-Endorse-02, TC-Admin-02). |
| 9 | The Developer Lead tested his own modules (policies, payments, documents, PDF, web UI), whose branch coverage was 76–82 %, and found DEF-08..14: double charges, unpaid endorsements, wrong refunds after renewal, loose endorsement text, accented names in PDFs, colour contrast and logout not revoking the token. The WCAG audit (TC-UX-01), planned for UAT, was automated with axe-core. | 32 test cases: section 3.2 (TC-Pay-03..08, TC-Endorse-03..06, TC-Cancel-03..05, TC-Renew-03/04, TC-Policy-03/04, TC-Doc-01/02, TC-PDF-03..05) and section 3.16 (TC-UX-01..05). |

After all changes: **154 test cases in 22 files** (122 after the QA cycle, then 32 from the Developer Lead). Branch coverage of the QA Lead's modules: claims 96.55 %, fraud 100 %, settlement 100 %, notifications 100 %.

## 2. Conventions

- **Level:** U = unit (function called directly), I = integration (module through the HTTP API with a real database), S = system (end-to-end business flow across several modules).
- **Status** is the result of the run on 17-11-2026: P = passed. All 154 automated cases passed (122 in the QA cycle, 32 added by the Developer Lead the same day).
- Every API test runs against an isolated in-memory database created by `test/helpers.js`, with one user per role (ADMIN, UNDERWRITER, ADJUSTER, AGENT, CUSTOMER) and synthetic customer data (STP §6 "Test Data").
- Run everything with `npm test`; run with coverage with `npm run test:coverage`.

## 3. Test cases by requirement

### 3.1 Quotes and underwriting (owner: Sanjith) — `test/quote-underwriting.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Quote-01 | F-001 | I | Request a quote with valid input | 200 with premium breakdown, returned within 10 s | P |
| TC-Quote-02 | F-001 | I | Request a quote with invalid input | 400 with the standard error envelope | P |
| TC-Quote-03 | F-001 | U | Premium personalised by age, smoking and term | Premium changes in the expected direction | P |
| TC-Quote-04 | F-001, SAD 3.7 | I | Actuarial service outage | 503 returned, no partial quote | P |
| TC-UW-01a | F-002 | U | Risk score bounds and rules | Score stays within 0–100, rules fire | P |
| TC-UW-01b | F-002 | S | Low vs high risk applications | Low risk auto-approves; high risk goes to manual review per threshold | P |
| TC-UW-02 | F-002 | I | Admin changes the risk threshold | New threshold applies to the next application | P |
| TC-KYC-01 | F-003 | S | KYC pass and fail | Result is returned before issuance | P |
| TC-KYC-02 | F-003 | S | KYC provider outage | Application goes to manual queue, underwriter resolves it, flow resumes | P |
| TC-Quote-05 | F-001 | I | Apply with an expired or already-used quote | Request refused | P |

### 3.2 Policies, payments and documents (owner: Samarth) — `test/policy.test.js`, `test/policy-cancellation.test.js`, `test/renewals-report.test.js`, `test/payments-hardening.test.js`, `test/endorsement-cancellation.test.js`, `test/documents-pdf.test.js`, `test/policies-payments-edge-cases.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Policy-01 | F-010, SR-005 | S | Successful payment | Policy issued with a signed PDF | P |
| TC-Policy-02 | F-010 | S | Failed and transiently failing payments | No policy on failure; retries recover transient failures | P |
| TC-Invoice-01 | F-013 | I | Invoice after payment | Invoice PDF with GST breakup stored | P |
| TC-Renew-01 | F-011 | S | Renewal reminder job | Reminders at 30, 15 and 7 days before expiry, once each | P |
| TC-Renew-02 | F-011 | S | Renew a policy | Period extended after payment | P |
| TC-Endorse-01 | F-012 | I | Endorse a policy | Change applied and recorded in the audit trail | P |
| TC-Cancel-01 | F-014 | S | Cancel an active policy | Pro-rata refund of the unexpired premium minus 5 % fee | P |
| TC-Cancel-02 | F-014 | I | Cancel a non-active or expired policy, invalid request | Request refused | P |
| TC-Renewal-Report-01 | F-033 | I | Renewals-due report | Active policies by soonest expiry with days to expiry | P |
| TC-Renewal-Report-02 | F-033, F-031 | I | Renewals report as PDF | PDF rendered; admin only | P |
| TC-Renewal-Report-03 | F-032 | I | Dashboard renewal pipeline | Overdue and window-open counts shown | P |
| TC-Pay-03 | F-010 | S | Two premium payments for one application sent at once | One charge, one policy; the other request gets 409 PAYMENT_IN_PROGRESS; a later retry gets ALREADY_ISSUED | P (failed before fix, DEF-08) |
| TC-Pay-04 | F-011 | S | Two renewals of one policy sent at once | One renewal charge, policy extended once | P (failed before fix, DEF-08) |
| TC-Pay-05 | F-010 | I | Declined payment, then retry | Lock released; retry succeeds | P |
| TC-Pay-06 | F-010 | I | Missing fields, unknown application, application not approved, unknown token, someone else's application | 400, 404, 409 (nothing charged), 402, 403 | P |
| TC-Pay-07 | F-031 | I | Payment history by role | Customer: own; agent: portfolio; admin: all; adjuster: none | P (agent list was empty before) |
| TC-Pay-08 | F-014, F-023 | U | Refund, payout and charge with negative, NaN or zero amounts | Rejected | P |
| TC-Endorse-03 | F-012, F-013 | S | Raise the sum insured without payment, with a declined card, then paid | 402 PAYMENT_REQUIRED with the amount; declined changes nothing; paid applies the change, records an ENDORSEMENT payment and a GST invoice | P (failed before fix, DEF-09) |
| TC-Endorse-05 | F-012 | I | Lower the sum insured; change only the nominee | Difference refunded; nominee change costs nothing | P (failed before fix, DEF-09) |
| TC-Endorse-04 | F-012 | I | Nominee/address as object, array or number; sum insured as hex, boolean, array or "7e5"; then "700000" | 400 and nothing saved; plain decimal string accepted (asks for payment) | P (failed before fix, DEF-11) |
| TC-Endorse-06 | F-012, F-031 | I | Empty body, unknown field, too-short nominee/address, sum insured below 50,000 or above the income limit, underwriter endorsing, cancelled policy | 400 / 403 / 409 | P |
| TC-Cancel-03 | F-014 | S | Renew early, then cancel | Refund = unused days of the old year + the whole new year, minus 5 % | P (failed before fix, DEF-10) |
| TC-Cancel-04 | F-014 | S | Cancel during the renewed year | Renewal premium pro-rated over the renewed year only | P (failed before fix, DEF-10) |
| TC-Cancel-05 | F-014, F-012 | S | Pay for an endorsement, then cancel the same day | Endorsement payment refunded in full with the unused premium | P |
| TC-Renew-03 | F-011 | I | Reminder job after a policy's end date | Policy marked EXPIRED | P |
| TC-Renew-04 | F-011 | I | Renew without a token, after the 30-day grace period, above the maximum age, or a cancelled policy | 400, 409 LAPSED, 422 NOT_RENEWABLE, 409 NOT_RENEWABLE; nothing charged | P |
| TC-Policy-03 | F-010 | S | Policyholder named "Zoë Fernández" | Name printed exactly on the signed schedule | P (failed before fix, DEF-12) |
| TC-Policy-04 | F-010, F-031 | I | Policy lists by role; look up by policy number; unknown id | Scoped lists; invoice listed with the policy; 404 | P |
| TC-Doc-01 | SR-005, F-031 | I | Read and verify documents as another customer, an agent outside / inside the portfolio, staff, anonymous | 403, 403 / 200, 200, 401; unknown id 404 | P |
| TC-Doc-02 | SR-005 | I | Public signing key; verify an uploaded (unsigned) claim document | PEM key; `signed: false`, integrity valid | P |
| TC-PDF-03 | F-010, F-013 | U | Accented Latin text and typographic punctuation | Accents kept; quotes, dashes, ₹ and … mapped to plain text | P (failed before fix, DEF-12) |
| TC-PDF-04 | F-010 | U | Text the PDF fonts cannot draw (Devanagari) | One "?" per character; file offsets still valid | P |
| TC-PDF-05 | F-010 | U | Empty document; unbroken 500-character word at a page end | One page; word split and continued on a new page | P |

### 3.3 Admin, security and RBAC (owner: Sampreeth) — `test/admin-security.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Admin-01 | F-030 | I | Deploy a BPMN workflow | Valid BPMN deployed; invalid BPMN refused | P |
| TC-RBAC-01 | F-031, STP 5.1 | I | Call every module with the wrong role | 401/403 everywhere (RBAC bypass attempts fail) | P |
| TC-Dash-01 | F-032 | I | Load the dashboard | SLA metrics, claim backlog, policy counts in under 3 s | P |
| TC-Report-01 | F-033 | I | Export reports | Valid CSV and PDF | P |
| TC-Audit-01 | F-034, NF-004 | I | Tamper with the audit log | Append-only; tampering is detected by the hash chain | P |
| TC-Sec-01 | NF-003 | I | Inspect stored PII | Encrypted at rest with AES-256-GCM | P |
| TC-Sec-MFA-01 | SR-002 | I | Admin/underwriter login without OTP | Refused; MFA enforced | P |
| TC-Sec-MFA-02 | SR-002 | I | Replay a used TOTP code | Refused | P |
| TC-Sec-PII-01 | SR-003, STP 5.1 | I | Read customer data as different roles | PII masked in API and logs except for authorised roles | P |
| TC-Sec-RL-01 | SR-004 | I | Flood a public API | 429 after the limit | P |
| TC-Sec-Sign-01 | SR-005 | I | Verify and tamper with an issued document | Signature valid; tampering detected | P |
| TC-Sec-TLS-01 | SR-001, NF-003 | I | Start the HTTPS server | TLS 1.2 minimum enforced; HSTS sent | P |
| TC-Sec-Lock-01 | SR-002/004 | I | Repeated failed logins | Account locks; admin can unlock | P |
| TC-Sec-Lock-02 | SR-002/004 | I | Successful login after failures | Failure counter reset | P |
| TC-Sec-Mig-01 | — | U | Open a database from before the hardening columns | Migrated on open | P |
| TC-Sec-Revoke-01 | SR-002 | I | Logout | Token revoked immediately; other sessions keep working | P |
| TC-Sec-Trace-01 | STP 5.1 (fuzzing) | I | Send malformed trace ids | Only well-formed ids echoed | P |

### 3.4 Performance and shared units — `test/performance-unit.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Perf-01 | NF-001 | S | 400 quote and claim-status requests in-process | p95 under 2 s | P |
| TC-Unit-01 | F-021 | U | BPMN condition evaluator | Comparisons and logic work; code injection rejected (no `eval`) | P |
| TC-Unit-02 | F-021, F-030 | U | BPMN structural validator | Missing start, missing candidate group, unreachable node all caught | P |
| TC-Unit-03 | SAD 3.7 | U | Circuit breaker | Opens after failures, half-opens after reset window | P |
| TC-Unit-04 | SAD 3.7 | U | Retry with backoff | Exponential backoff; stops on non-retryable errors | P |
| TC-Unit-05 | F-010 | U | PDF writer | Structurally valid multi-page PDF | P |

### 3.5 Claims and workflow (owner: Vishal) — `test/claims-workflow.test.js` (original Sprint 1/2 cases)

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Claim-01 | F-020 | S | Customer registers a claim with a PDF | 201, claim ID `C` + 10 hex, status UNDER_REVIEW, ETA; fraud details hidden from customer | P |
| TC-Claim-02 | F-020, STP 5.1 | I | Oversize file, .exe, spoofed PDF, someone else's policy, future date, wrong claim type, unknown policy | 413, 400, 400, 403, 422, 422, 404 | P |
| TC-WF-01 | F-021 | S | Low-value vs high-value claim | ≤ 100,000: adjuster only; > 100,000: adjuster then senior (ADMIN); adjuster cannot do the senior step | P |
| TC-WF-02 | F-021, F-030 | S | Rejection; deploy workflow v2 with a 10,000 limit | Rejection ends the flow; new version changes routing | P |
| TC-Fraud-01 | F-022 | S | File the same claim twice | DUPLICATE_CLAIM, score ≥ 50, routed to fraud investigation, audit entry | P |
| TC-Settle-01 | F-023, SR-005 | S | Approve a reduced amount and settle | Payable = (approved − 5,000) × 0.9; payout reference; signed letter verifies | P |
| TC-Notify-01 | F-024 | S | Claim goes through all statuses | Customer gets REGISTERED, UNDER_REVIEW, APPROVED, SETTLED in-app and by email | P |

### 3.6 Fraud rules and settlement formula (new) — `test/fraud-settlement.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Fraud-02 | F-022 | U | Clean claim | No rule fires, score 0, not flagged | P |
| TC-Fraud-03 | F-022 | U | Same type at 0, +7, −7 days | DUPLICATE_CLAIM (60), flagged | P |
| TC-Fraud-04 | F-022 | U | 8 days apart, different type, prior claim rejected | No duplicate | P |
| TC-Fraud-05 | F-022 | U | Amount above remaining cover; exactly equal | EXCEEDS_REMAINING_COVER (30) only when above; replaces HIGH_VALUE_RATIO | P |
| TC-Fraud-06 | F-022 | U | Amount at 80 % and just above 80 % of sum insured | HIGH_VALUE_RATIO (20) only above 80 % | P |
| TC-Fraud-07 | F-022 | U | Incident on day 30 and day 31 of the policy | EARLY_CLAIM (25) on day 30 only | P |
| TC-Fraud-08 | F-022 | U | 1 vs 2 recent claims; day 90 vs 91; rejected claim | FREQUENT_CLAIMS (25) for ≥ 2 non-rejected claims within 90 days | P |
| TC-Fraud-09 | F-022 | U | No documents; default arguments | NO_SUPPORTING_DOCUMENTS (15) | P |
| TC-Fraud-10 | F-022 | U | Reported on day 30 and day 31 after the incident | LATE_REPORTING (10) on day 31 only | P |
| TC-Fraud-11 | F-022 | U | Score exactly 50; every rule at once | Flagged at 50; total 165 capped at 100 | P |
| TC-Settle-02 | F-023 | U | Health, 90,000 on 100,000 | Deductible 5,000, co-pay 8,500, payable 76,500 | P |
| TC-Settle-03 | F-023 | U | Motor, home, life | Payable 47,500 / 40,000 / 1,000,000; no co-pay | P |
| TC-Settle-04 | F-023 | U | 30,000 after 76,500 already paid on 100,000 | Remaining 23,500, payable 16,650 | P |
| TC-Settle-05 | F-023 | U | Cover used up; amount below deductible | Remaining never negative; payable 0 | P |
| TC-Settle-06 | F-023 | U | Fractional amount | Rounded to 2 decimals | P |
| TC-Settle-07 | F-023 | U | Unknown coverage type | Error | P |

### 3.7 Claims API edge cases (new) — `test/claims-edge-cases.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Claim-03 | F-020, STP 5.1 (fuzzing) | I | Amount 0, negative, text; bad date format; missing date; date before policy start; missing claim type | 422 INVALID_CLAIM with the matching message | P |
| TC-Claim-04 | F-020 | S | Claim on a cancelled policy | 422 POLICY_NOT_ACTIVE | P |
| TC-Claim-05 | F-020, STP 5.1 | I | Documents not an array, 11 files, empty file, missing type, null entry, JPEG sent as PNG | 400 each | P |
| TC-Claim-06 | F-020 | I | PNG and JPEG accepted, unsafe filename, no filename, no documents, 2,500-char description | 201; filename sanitised / defaulted; description cut to 2,000; NO_SUPPORTING_DOCUMENTS flag | P |
| TC-Claim-07 | F-020, F-031 | I | List claims as customer, agent, adjuster; status filter; `/claim` alias; unknown and foreign claim | Each role sees only its scope; 404 / 403 | P |
| TC-Claim-08 | F-020, F-031 | S | Agent files a claim for a portfolio customer | 201; agent can list it; fraud score and tasks hidden from agent | P |
| TC-Claim-09 | F-020 | I | Add documents to an open claim, as adjuster, to a rejected claim | 201 + audit entry; 403; 409 CLAIM_CLOSED | P |
| TC-WF-03 | F-021, F-031 | I | Decision on unknown claim, by ADMIN before senior step, by customer, with approvedAmount −1 / above claim / text / empty | 404, 403, 403, 400 ×3, empty approves full amount | P |
| TC-Settle-08 | F-023, F-031 | I | Settle unknown claim, unapproved claim, as customer/admin, twice | 404, 409 NOT_APPROVED, 403, 403, second settle 409 | P |
| TC-Settle-09 | F-022, F-023 | S | Two claims on a 100,000 health policy | First pays 76,500; second (30,000) is flagged, routed to fraud investigation, ETA 10 days, capped at 23,500, pays 16,650 | P |
| TC-Claim-10 | F-020, F-021 | I | Workflow events for another process, unknown claim, missing / too high / negative / text approved amount | Ignored or clamped to 0 … claimed amount | P |

### 3.8 Notification service (new) — `test/notifications.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Notify-02 | F-024 | I | Customer with email and phone | In-app DELIVERED, email SENT, SMS SENT, with decrypted contact details | P |
| TC-Notify-03 | F-024 | I | Email only; neither email nor phone | Channels follow the contact details | P |
| TC-Notify-04 | F-024 | U | Unknown customer | Ignored, nothing stored | P |
| TC-Notify-05 | F-024 | I | Agent-managed customer | Agent gets an in-app copy | P |
| TC-Notify-06 | F-024, SAD 3.7 | I | Email provider down | 3 attempts, email FAILED, SMS still SENT | P |
| TC-Notify-07 | F-024, SAD 3.7 | I | SMS fails once | Succeeds on 2nd attempt | P |
| TC-Notify-08 | F-024, F-021 | I | Broadcast to a role; notify one user | Only active users with the role; single in-app row | P |
| TC-Notify-09 | F-024, F-031 | I | Inbox and mark as read | Only own in-app messages; cannot mark others' (404); 401 without login | P |

### 3.9 Notification resilience, DEF-01 (new) — `test/notifications-resilience.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Notify-10 | F-024, NF-002 | I | Customer's email was encrypted with another key (as after a restart without DATA_KEY) | `notifyCustomer` resolves; in-app DELIVERED; email FAILED | P (failed before fix) |
| TC-Notify-11 | F-020, NF-002 | S | Same customer files a claim | 201; no unhandled promise rejections; server still answers `/health` | P (failed before fix) |
| TC-Notify-12 | F-020..024 | S | Notification service throws (sync and async) during a full claim lifecycle | Claim still registered, approved and settled; each failure logged | P |

### 3.10 Claims API contract, SAD §4.3.2 and §4.4 (new) — `test/claims-contract.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Contract-01 | SAD 4.3.2, F-020 | I | `POST /api/v1/claim` (SAD path) | 201, claim ID, ETA "5 days"; status UNDER_REVIEW (documented deviation); REGISTERED first in timeline | P |
| TC-Contract-02 | SAD 4.3.2 | I | No token, invalid token, unknown policy P456, negative amount | 401, 401, 404, 422 with SAD envelope | P |
| TC-Contract-03 | SAD 4.4 | I | 404, 403, 400, 409, 400 errors on claim routes | Every error has `code`, `message`, `traceId` = `X-Trace-Id` header | P |
| TC-Contract-04 | SAD 4.4 | I | Client sends `X-Trace-Id` | Same id echoed in header and error body | P |
| TC-Contract-05 | SAD 4.4, STP 5.1 | I | Malformed JSON body | 400 INVALID_INPUT "Malformed JSON", not 500 | P |

### 3.11 Date validation, DEF-02 (new) — `test/date-validation.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Date-01 | F-020, F-003 | U | Real dates incl. 2024-02-29 | Accepted | P |
| TC-Date-02 | F-020, F-003 | U | 2026-02-30, 2026-02-31, 2026-04-31, 2026-06-31, 2025-02-29, 1900-02-29 | Rejected (no roll-over to next month) | P (failed before fix) |
| TC-Date-03 | F-020 | U | Wrong formats and types | Rejected | P |
| TC-Claim-11 | F-020 | I | Claim with incident date 2026-02-30 | 422 INVALID_CLAIM | P (failed before fix) |

### 3.12 Claims security, STP §5.1 (new) — `test/claims-security.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Sec-Claim-01 | F-031, STP 5.1 | I | RBAC matrix: 6 actors × 5 claim actions (30 checks) | Only the owner files/views/uploads; only the adjuster decides and settles; staff view | P |
| TC-Sec-Claim-02 | F-031, SR-002 | I | No token, role-forged JWT, unsigned JWT, garbage on 4 claim routes | 401 everywhere | P |
| TC-Sec-Claim-03 | SR-003 | I | Claimant views own claim | No fraud score, flags or internal tasks | P |
| TC-Sec-Claim-04 | STP 5.1 | I | SQL/script/template injection in description, policy id, claim type, claim id, status filter | Stored as text / 404 / 422 / empty result; table intact | P |
| TC-Sec-Claim-05 | STP 5.1 | I | Filenames `../../etc/passwd.pdf`, CR/LF, backslash | No path separators or line breaks stored | P |
| TC-Sec-Claim-06 | F-020, STP 5.1 | I | Amount `true`, `[5]`, `"0x10"`, `{}`, `null`, blank, `"1e400"`, `"NaN"`, −5 | 422; numbers and decimal strings still accepted | P (failed before DEF-03 fix) |
| TC-Sec-Claim-07 | F-021 | I | Approved amount `true`, `[100]`, `"0x10"` | 400; `"4000"` accepted | P (failed before DEF-03 fix) |

### 3.13 Signed settlement letter, SR-005 (new) — `test/settlement-letter.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Settle-10 | F-023 | S | Download letter for a 90,000 health claim on 100,000 cover | PDF states claim id, 90,000.00, 5,000.00, 8,500.00, 76,500.00 and payout reference | P |
| TC-Settle-11 | SR-005 | I | Verify with only the published public key | Ed25519 signature valid; SHA-256 header matches | P |
| TC-Settle-12 | SR-005, SAD 3.9 (tampering) | I | Change 76,500.00 to 96,500.00 in the stored letter | Signature and integrity checks fail | P |
| TC-Settle-13 | F-031 | I | Download as stranger, agent, adjuster | 403, 403, 200 | P |

### 3.14 Track Claim Status use case, SRS §7.1 (new) — `test/claim-tracking.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Track-01 | F-024, SRS 7.1 | S | Timeline after settlement | REGISTERED → UNDER_REVIEW → APPROVED → SETTLED, in time order | P |
| TC-Track-02 | F-024 | S | Message text | Each names the claim; approval and settlement state INR 31500 for a 40,000 health claim | P |
| TC-Track-03 | F-024 | S | Rejected claim | Claimant told to contact support; no settlement | P |
| TC-Track-04 | F-021, F-024 | S | New claim | Adjuster group gets "New task 'Adjuster review' for claim …" | P |
| TC-Track-05 | F-024 | S | Email vs in-app | One email per in-app status message (4 each) | P |

### 3.15 Numeric inputs across modules, DEF-04..07 (new) — `test/numeric-input.test.js`

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-Num-01 | STP 5.1 | U | `parseNumber()` with numbers and decimal strings (5, "5", " 7 ", "-3", "1500.50") | Parsed to the same number | P |
| TC-Num-02 | STP 5.1 | U | `true`, `[5]`, `{}`, `null`, `""`, `"0x10"`, `"1e5"`, `"1,500"`, Infinity | NaN (rejected) | P |
| TC-Quote-06 | F-001 | I | Quote with `age: [30]` / `true`, `income: "0x10000"` / `true`, `term: true` / `[2]`, `sumInsured: [100000]` / `"1e6"` | 400 INVALID_INPUT | P (failed before fix) |
| TC-Quote-07 | F-001 | I | Same quote with numbers vs numeric strings; blank sum insured | Same premium; blank uses the product default | P |
| TC-KYC-03 | F-003 | I | Customer profile income `true`, `""`, `" "`, `[500000]`, `"0x10000"`, `null`; then `"750000"` and `0` | 400 for each; numeric string and real 0 accepted | P (failed before fix) |
| TC-KYC-04 | F-003 | I | Profile update with `income: true`; update without income | 400; stored income kept | P |
| TC-Endorse-02 | F-012 | I | Endorse `sumInsured` `"0x10000"`, `[700000]`, `true`; then `"600000"` | 400 and cover/history unchanged; numeric string raises cover with extra premium | P (failed before fix) |
| TC-Admin-02 | F-002 | I | Risk threshold `true`, `false`, `""`, `[70]`, `"0x40"`, `null`; then `"70"` | 400 and threshold unchanged; `"70"` saved | P (failed before fix) |

### 3.16 Web UI accessibility and session (owner: Samarth, new) — `test/ui-accessibility.test.js`

Every screen is rendered from the real app (seeded demo data) in jsdom and checked with axe-core 4.10 against the WCAG 2.0/2.1 A and AA rules. jsdom cannot measure colour, so contrast is computed from the stylesheet's colour tokens.

| ID | Req | Level | Test case | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| TC-UX-01 | NF-005 | S | Sign-in screen | No WCAG A/AA violations | P |
| TC-UX-02 | NF-005 | S | Every navigation screen and the policy details panel, for each of the five roles | No WCAG A/AA violations | P |
| TC-UX-03 | NF-005 | S | Skip link, language switch label, live region, current-page marker | Present and correctly wired | P |
| TC-UX-04 | NF-005 | U | Text and focus-ring contrast in light and dark themes | Text ≥ 4.5:1, focus ring ≥ 3:1 | P (failed before fix, DEF-13) |
| TC-UX-05 | F-031, SR-002 | S | Log out in the UI, then reuse the copied token | Token revoked: 401 | P (failed before fix, DEF-14) |

## 4. Manual and environment-dependent checks

| ID | Req | Check | Result on 17-11-2026 |
| --- | --- | --- | --- |
| TC-Smoke-01 | NF-002 | Start `src/server.js`, call `/api/v1/health` | `{"status":"UP"}`; also run in CI after every push |
| TC-Smoke-02 | SR-001, STP 5.1 | Response headers on the running server | HSTS, CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` present |
| TC-Smoke-03 | F-031 | `GET /api/v1/claims` without a token; `POST /api/v1/quote` with empty body | 401; 400 |
| TC-UX-01 | NF-005 | WCAG 2.1 AA audit (axe / Lighthouse) | Automated with axe-core and a contrast check, see section 3.16. Still to do at UAT: a screen-reader walk-through and a check in real browsers |
| TC-Perf-02 | NF-001 | k6 load test `perf/quote-load.js` (quote and claim-status APIs, p95 < 2 s each) against a deployed environment | Script ready; setup flow checked against a running instance; not run yet: needs a deployed environment |
| TC-Sec-ZAP-01 | STP 5.1 | OWASP ZAP scan | Not run yet: CI runs CodeQL, gitleaks and `npm audit` instead |

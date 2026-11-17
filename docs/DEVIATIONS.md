# Deviations from the SRS, SAD and STP: claims, fraud, settlement, notifications and testing

| | |
| --- | --- |
| Prepared by | Sakaray Vishal (QA Lead; owner of claims, fraud, settlement, notifications) |
| Date | 17-11-2026 |
| Compared | SRS v1.0 (18-08-2025) §4.3, §7; SAD v1.0 (09-09-2025) §3.4, §4.2.2, §4.3.2, §4.6; STP v1.0 (31-08-2025) |
| Why | The course FAQ allows deviations from the submitted documents if they are documented and explained at the demo. |

Technology-stack differences that affect the whole system (Kafka, Camunda, PostgreSQL, S3, Spring Boot) are in [README.md, "Differences from the documented stack"](../README.md#differences-from-the-documented-stack). Sections 1–6 cover the parts owned by the QA Lead; section 7 was added by the Developer Lead (Samarth A) for policies, payments, documents and the web UI.

## 1. Claims API (SAD §4.3.2)

| # | Document says | Implemented | Reason | Impact |
| --- | --- | --- | --- | --- |
| C1 | `POST /api/v1/claim` | Both `/api/v1/claim` and `/api/v1/claims` (plus `GET`, `/documents`, `/decision`, `/settle` sub-routes) | REST collections are plural elsewhere in the API; the singular SAD path is kept as an alias so the documented contract still works | None. TC-Contract-01 calls the SAD path. |
| C2 | Request field `"docs": ["doc1.pdf"]` (file names) | `"documents": [{ filename, mime, contentBase64 }]` | The server must receive the file itself to enforce the 10 MB limit (SRS F-020) and check the real file type, not just a name | Clients send the file content. TC-Claim-02/05/06. |
| C3 | Response `"status": "REGISTERED"` | `"status": "UNDER_REVIEW"` | Registration starts the BPMN workflow, which creates the first review task at once and moves the claim to UNDER_REVIEW in the same request | `REGISTERED` is still recorded (first timeline entry, first notification). TC-Contract-01, TC-Track-01. |
| C4 | Errors 401, 404, 422 | Those three, plus 400 (bad documents), 403 (not your policy / wrong role), 409 (claim closed / not approved), 413 (file too large) | More precise errors for cases the SAD did not list | All use the SAD §4.4 envelope `{ code, message, traceId }` (TC-Contract-03). |
| C5 | `eta: "5 days"` | `"5 days"`, or `"10 days"` when the claim is flagged for fraud investigation | A flagged claim has an extra investigation step | TC-Settle-09. |

## 2. Claim workflow (SRS F-021, SAD §4.2.2)

| # | Document says | Implemented | Reason |
| --- | --- | --- | --- |
| W1 | Sequence: Workflow Engine → "Assign to adjuster" → "Review and approve" | Same, with two configurable extra steps: **Fraud investigation** first if the fraud flag is raised, and **Senior claims approval** (ADMIN role) after the adjuster for claims above 100,000 | SRS F-021 asks for *multi-level* approval; the SRS roles (§2.3) have no "senior adjuster", so Admin/Ops takes the senior step. Limits live in `claim-approval.bpmn` and can be changed by deploying a new version (TC-WF-02). |
| W2 | Statuses: registered, under review, approved, settled (SRS F-024) | Those four plus **REJECTED** | A claim can be turned down at any approval step; the claimant is told (TC-Track-03). |
| W3 | Sequence: Workflow Engine sends "Notify claim registered" | The Claims Service sends claimant notifications on every status change; the workflow engine's task events trigger "new task" alerts to the adjuster group | Keeps all claimant messages in one place (`STATUS_MESSAGES` in `claims.js`). |

## 3. Fraud detection (SRS F-022, SAD §4.6)

The SRS says "rule-based … duplicate claims, unusual patterns" without listing rules, and the SAD lists AI-based fraud detection as future work. Implemented as seven weighted rules in `src/modules/fraud.js`. The two cover rules exclude each other, so at most six fire at once; the score is capped at 100, and a claim is flagged at 50 or more:

| Rule | Points | Unusual pattern it catches |
| --- | --- | --- |
| DUPLICATE_CLAIM | 60 | Same claim type within 7 days of another non-rejected claim (always flags) |
| EXCEEDS_REMAINING_COVER | 30 | Claim larger than the cover left |
| HIGH_VALUE_RATIO | 20 | Claim above 80 % of the sum insured |
| EARLY_CLAIM | 25 | Incident within 30 days of policy start |
| FREQUENT_CLAIMS | 25 | 2 or more other claims in the last 90 days |
| NO_SUPPORTING_DOCUMENTS | 15 | No evidence uploaded |
| LATE_REPORTING | 10 | Reported more than 30 days after the incident |

This is a refinement, not a change of scope. The ML model stays as future work.

## 4. Settlement (SRS F-023)

The SRS says "based on policy terms" without the terms. Implemented per coverage type:

| Coverage | Deductible | Co-pay |
| --- | --- | --- |
| Health | 5,000 | 10 % |
| Motor | 2,500 | 0 % |
| Home | 10,000 | 0 % |
| Life | 0 | 0 % |

`payable = (min(approved, sumInsured − alreadyPaid) − deductible) × (1 − coPay)`, never below 0. Remaining cover is reduced by what was **paid**, not what was claimed (DEFECT_LOG OBS-01).

## 5. Notifications (SRS §3.3, SAD §3.4)

| # | Document says | Implemented | Reason |
| --- | --- | --- | --- |
| N1 | Email via SendGrid, SMS via Twilio | Swappable provider adapters (`providers.email`, `providers.sms`) that log the message; real vendors plug in at the same point | No vendor accounts or keys in a student project; tests replace the adapters to simulate outages (TC-Notify-06/07). |
| N2 | Node.js Kafka consumer | Direct call from the Claims Service, with retry (3 attempts, exponential backoff) per channel | No Kafka (see README). A failed channel is stored as FAILED, never lost silently. |
| N3 | Not specified | A notification failure can never fail a claim or crash the server | Found as DEF-01 during testing; see the defect log. |

## 6. Testing (STP v1.0)

| # | STP says | Done | Reason |
| --- | --- | --- | --- |
| T1 | §5 Unit tests with JUnit + Jest | Node's built-in `node:test` | The project is Node.js; no extra test framework needed |
| T2 | §6 Selenium/Playwright, Postman/RestAssured | API tests through real HTTP calls to the running Express app | Covers the same API; the web UI is not automated |
| T3 | §6 PostgreSQL test DB, Kafka test cluster, Camunda, S3 test bucket | A fresh in-memory SQLite database per test file; in-process event bus; in-house BPMN engine | Matches the implementation stack; tests are isolated and repeatable |
| T4 | §6 JMeter / k6 | k6 script `perf/quote-load.js` (quote and claim-status APIs) for a deployed environment, plus TC-Perf-01 in-process in every CI run | No shared deployed environment yet |
| T5 | §5.1 OWASP ZAP, penetration testing | Automated security tests (RBAC matrix, forged JWTs, injection, path traversal, MFA, lockout) + CI CodeQL, gitleaks, `npm audit` | ZAP scan still to do against the Docker image |
| T6 | §6 Jira for defects | GitHub pull requests and [DEFECT_LOG.md](reports/DEFECT_LOG.md) | Course instruction: no Jira |
| T7 | §7 Execution 08–20 Sep 2025 | Executed 17 Nov 2026 on the latest `main` | The STP dates came from the template; the course Part-3 window was 2–6 Nov 2026 and testing ran late |
| T8 | §3 lists 9 features | All 18 functional, 5 non-functional and 5 security requirements in the RTM are tested | Scope grew with the sprints; see [TEST_CASES.md](TEST_CASES.md) §1 |
| T9 | No coverage target | Coverage measured with c8 and enforced in CI (statements ≥ 93 %, branches ≥ 80 %) | Added so the Code and Branch Coverage Reports stay true after future changes |

## 7. Policies, payments, documents and web UI (Developer Lead)

| # | Document says | Implemented | Reason |
| --- | --- | --- | --- |
| P1 | SAD §3.4 Payment Service "Java + Razorpay SDK" | Gateway adapter with sandbox tokens (`tok_success`, `tok_decline`, `tok_flaky`) behind `charge` / `payout` / `refund` | No card data reaches IWAS (PCI-DSS scope); a real gateway client replaces the adapter only |
| P2 | SAD §3.4 Document Service "Python + S3" | Node.js document store in the database with the same operations (store, fetch, verify) | Matches the single-language stack; S3 is a storage swap |
| P3 | SRS F-012 endorsement "with audit trail" (premium not mentioned) | A higher sum insured is charged before it applies (402 PAYMENT_REQUIRED without a token); a lower one is refunded | Found as DEF-09: without it the extra cover was free |
| P4 | Not specified | One payment at a time per application or policy (409 PAYMENT_IN_PROGRESS) | Found as DEF-08: double-submitted payments charged twice |
| P5 | SRS F-014 cancellation "pro-rata refund" | Refund of the unused premium per paid period, including endorsement payments, less a configurable charge | Found as DEF-10: a single pro-rata over the whole span was wrong after renewals |
| P6 | SAD §4.5 multi-language UI | Navigation and headings in English and Hindi; generated PDFs are in English and use the standard PDF fonts, so Devanagari text in PDFs prints as "?" | Embedding a Unicode font is a follow-up (OBS-07) |
| P7 | STP §6 Selenium/Playwright for UI | jsdom + axe-core: every screen of every role rendered from the real app and checked against WCAG 2.0/2.1 A and AA; contrast computed from CSS tokens | Runs in CI without a browser; real-browser layout and a screen-reader pass remain for UAT |
| P8 | SAD §4.5 "voice assistance" | Not built; the UI works with screen readers (labels, live regions, skip link) instead | Out of scope for this release |


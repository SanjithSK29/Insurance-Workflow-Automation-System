# Developer Lead Report: policies, payments, documents and web UI

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) v1.0 |
| Report | Module test and hardening report (Part-3), Developer Lead's area |
| Prepared by | Samarth A (Developer Lead) |
| Date | 17-11-2026 |
| Branch | `samarth-dev-hardening`, based on `main` after PRs #6–#13 |
| Modules | `src/modules/policies.js`, `payments.js`, `documents.js`, `pdf.js`; web UI `public/` |
| Requirements | IWA-F-010 to F-014, IWA-SR-005 (documents), IWA-NF-005 (accessibility), SRS §3.1 (user interface) |
| Related | [Defect Log](DEFECT_LOG.md) (DEF-08..14) · [Code Review Log](CODE_REVIEW_LOG.md) · [Test Case Document](../TEST_CASES.md) §3.2 and §3.16 · [RTM](../TRACEABILITY.md) |

## 1. Summary

The QA cycle (Vishal, PRs #9–#11) concentrated on claims. This cycle did the same for the Developer Lead's modules, whose branch coverage was the lowest of the business modules (76–82 %), and for the web UI, which had no automated tests.

- **32 new automated test cases** in 5 files; the full suite is **154 / 154 passing**.
- **7 defects found and fixed (DEF-08..14):** 2 High, 3 Medium, 2 Low. Each was reproduced by a failing test committed before the fix.
- **Coverage of the four modules:** 100 % statements, 92–95 % branches (from 90.8–100 % / 76.2–81.9 %). Whole project: 96.44 % statements, 85.56 % branches (from 94.68 % / 82.18 %).
- **Accessibility (NF-005)**, previously "manual, planned for UAT", now runs in CI: axe-core finds no WCAG 2.0/2.1 A or AA violations on any screen of any role, and colour contrast meets AA in both themes after DEF-13.
- **Web UI** now reaches the features added after Sprint 2: policy cancellation (PR #8), the renewals report and metrics (PR #7), paying for endorsements, a payment history page, and server-side logout (PR #6).
- **Code review** of PRs #6–#13 completed; the Developer Lead's approval was the open item in the Test Summary Report. See the [Code Review Log](CODE_REVIEW_LOG.md).

## 2. What was tested

| Area | Test file | Cases | Focus |
| --- | --- | --- | --- |
| Payments under concurrency and failure | `test/payments-hardening.test.js` | TC-Pay-03..05 | Double-submitted payments and renewals; retry after a decline |
| Endorsement money and cancellation refunds | `test/endorsement-cancellation.test.js` | TC-Endorse-03..05, TC-Cancel-03..05 | Premium differences collected or refunded; refunds after renewals and endorsements |
| PDF text and documents | `test/documents-pdf.test.js` | TC-PDF-03/04, TC-Policy-03 | Accented names; unsupported scripts; valid file offsets |
| Edge cases and access rules | `test/policies-payments-edge-cases.test.js` | TC-Doc-01/02, TC-Pay-06..08, TC-Renew-03/04, TC-Endorse-06, TC-Policy-04, TC-PDF-05 | Who can read documents; validation before any charge; renewal refusals; role-scoped lists; PDF wrapping |
| Web UI | `test/ui-accessibility.test.js` | TC-UX-01..05 | axe-core on every screen of every role; contrast in both themes; keyboard aids; logout revocation |

The web UI test renders the real single-page app, signed in as each demo user against a running instance with seeded data. It clicks through every navigation item and opens the policy details panel, so the forms for endorsement, renewal and cancellation are checked too.

## 3. Results

| Metric | Before (end of QA cycle) | After |
| --- | --- | --- |
| Automated test cases | 122 | 154 |
| Passed | 122 | 154 |
| `documents.js` branches | 76.19 % | 92.00 % |
| `payments.js` statements / branches | 96.51 % / 77.27 % | 100 % / 95.23 % |
| `pdf.js` statements / branches | 90.80 % / 80.76 % | 100 % / 93.10 % |
| `policies.js` statements / branches | 97.92 % / 81.92 % | 100 % / 94.57 % |
| Project statements / branches / functions | 94.68 / 82.18 / 93.53 % | 96.44 / 85.56 / 94.16 % |
| WCAG A/AA violations (axe-core, all screens) | not measured | 0 |
| Colour pairs below AA | not measured | 0 (5 before the DEF-13 fix) |

Raw coverage table: [evidence/dev-lead-coverage-table.txt](evidence/dev-lead-coverage-table.txt). Reproduce with `npm ci && npm run test:coverage`.

## 4. Defects

| ID | Severity | Summary | Impact before the fix |
| --- | --- | --- | --- |
| DEF-08 | High | Double-submitted payment or renewal charged twice | Customer charged twice; two policies for one application |
| DEF-09 | High | Raising the sum insured did not collect the premium difference; lowering it did not refund | Free extra cover; lost premium |
| DEF-10 | Medium | Cancellation refund after a renewal used the wrong period | Customer refunded about half of what was owed |
| DEF-11 | Low | Non-text nominee/address accepted ("[object Object]") | Corrupt policy schedule |
| DEF-12 | Low | Accented names printed as "?" in PDFs | Wrong name on signed documents |
| DEF-13 | Medium | Five colour pairs below WCAG AA (mostly dark mode) | Hard to read for low-vision users; fails NF-005 |
| DEF-14 | Medium | Web UI logout did not revoke the token | A copied token kept working after logout |

Steps to reproduce, root causes and commits: [DEFECT_LOG.md](DEFECT_LOG.md).

## 5. Behaviour changes other owners should know about

| Change | Affects |
| --- | --- |
| `POST /policies/:id/endorse` returns **402 PAYMENT_REQUIRED** (with `details.premiumAdjustment`) when the sum insured goes up and no `paymentToken` is sent. Lowering it issues a refund. | API clients; Vishal's TC-Endorse-02 now sends a token |
| `POST /payments` and `POST /policies/:id/renew` can return **409 PAYMENT_IN_PROGRESS** for a duplicate request | Web UI already handles it as an error toast |
| Cancellation refunds are computed per paid period (`unusedPremium()`), including endorsement payments | Sanjith's cancellation; TC-Cancel-01/02 unchanged |
| `GET /payments` returns the agent's portfolio for agents (was empty) | Agents |
| Endorsement numbers use the shared `parseNumber()` from PR #11 | – |

## 6. Residual risks and follow-ups

| Item | Note |
| --- | --- |
| Payment lock is in-process (OBS-06) | Fine for the single-process SQLite deployment; a multi-instance deployment needs a database-level lock |
| PDF fonts cannot draw Devanagari (OBS-07) | Needs an embedded Unicode font; the UI itself is fine |
| Screen-reader walk-through | axe-core checks structure and names, not the spoken experience; do one pass with NVDA at UAT |
| Real-browser rendering | The jsdom checks do not cover layout; the flows were also clicked through in a browser on 17-11-2026 |
| Refunds on the Payments page (OBS-09) | Shown on the policy instead; small follow-up |

## 7. Approval

| Role | Name | Signature / Date |
| --- | --- | --- |
| Developer Lead | Samarth A | 17-11-2026 |
| QA Lead | Sakaray Vishal | |
| Project Lead | Sanjith Suresh Kumar | |

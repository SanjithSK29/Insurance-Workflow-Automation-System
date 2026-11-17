# Unit Test Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Report | Unit Test Report (Deliverables Part-3, item 2.b.i) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Test plan | STP v1.0 §5 (unit level); test cases in [TEST_CASES.md](../TEST_CASES.md) v2.1 |
| Build under test | Branch `vishal-qa-hardening` (= `main` at `b4c18dd` + PR #9 + PR #10) |
| Executed on | 17-11-2026 (planned window 02-11 to 06-11-2026; see section 8) |
| Result | **114 / 114 automated tests passed, 0 failed, 0 skipped.** 3 defects found and fixed during the cycle. |

## 1. Scope

The STP (§5) defines unit tests as module-level tests. In IWAS these are:

- **Pure unit tests:** functions called directly with no app, database or network: fraud rules, settlement formula, date validation, BPMN expression evaluator and validator, circuit breaker, retry, PDF writer, risk scoring, premium calculation.
- **Module tests through the API:** each service module exercised through its HTTP routes against an isolated in-memory SQLite database. The [System Validation Report](SYSTEM_VALIDATION_REPORT.md) looks at these per requirement.

This report covers the whole suite, with detail on the QA Lead's modules (claims, fraud, settlement, notifications).

## 2. Environment

| Item | Value |
| --- | --- |
| OS | Windows 11 Home (local run); Ubuntu (GitHub Actions CI) |
| Runtime | Node.js v25.2.0 (local); Node.js 22 (CI) |
| Test runner | `node:test` (built into Node), `--test-concurrency=1` |
| Assertions | `node:assert/strict` |
| Coverage | c8 10.1.3 (V8 native coverage), `.c8rc.json` with minimum thresholds |
| Database | SQLite in memory (`node:sqlite`), a new database per test file |
| Commands | `npm test` (results), `npm run test:coverage` (results + coverage + threshold check) |

## 3. Summary

| Metric | Baseline (`main`, 17-11-2026) | After PR #9 | Now (PR #10) |
| --- | --- | --- | --- |
| Test files | 7 | 10 | **16** |
| Test suites | 11 | 15 | **22** |
| Test cases | 51 | 86 | **114** |
| Passed | 51 | 86 | **114** |
| Failed | 0 | 0 | **0** |
| Skipped / todo | 0 | 0 | 0 |
| Pass rate | 100 % | 100 % | **100 %** |
| Suite duration | about 14 s | about 14 s | about 19 s |

## 4. Results by test file

| Test file | Owner | Tests | Passed | Failed |
| --- | --- | --- | --- | --- |
| quote-underwriting.test.js | Sanjith | 10 | 10 | 0 |
| policy.test.js | Samarth | 6 | 6 | 0 |
| policy-cancellation.test.js | Sanjith | 2 | 2 | 0 |
| renewals-report.test.js | Sanjith | 3 | 3 | 0 |
| admin-security.test.js | Sampreeth | 17 | 17 | 0 |
| performance-unit.test.js | shared (TC-Perf-01: Vishal) | 6 | 6 | 0 |
| claims-workflow.test.js | Vishal | 7 | 7 | 0 |
| fraud-settlement.test.js (PR #9) | Vishal | 16 | 16 | 0 |
| claims-edge-cases.test.js (PR #9) | Vishal | 11 | 11 | 0 |
| notifications.test.js (PR #9) | Vishal | 8 | 8 | 0 |
| **notifications-resilience.test.js** (PR #10) | Vishal | 3 | 3 | 0 |
| **claims-contract.test.js** (PR #10) | Vishal | 5 | 5 | 0 |
| **date-validation.test.js** (PR #10) | Vishal | 4 | 4 | 0 |
| **claims-security.test.js** (PR #10) | Vishal | 7 | 7 | 0 |
| **settlement-letter.test.js** (PR #10) | Vishal | 4 | 4 | 0 |
| **claim-tracking.test.js** (PR #10) | Vishal | 5 | 5 | 0 |
| **Total** | | **114** | **114** | **0** |

`test/helpers.js` is the shared harness (owner: Vishal), not a test file.

## 5. Unit tests for the QA Lead's modules

### 5.1 `src/modules/fraud.js`: `detectFraud()`

Each rule is tested on both sides of its boundary.

| Rule | Points | Boundary tested | Test |
| --- | --- | --- | --- |
| DUPLICATE_CLAIM | 60 | same type at 0 / ±7 days fires; 8 days, other type, rejected prior do not | TC-Fraud-03, TC-Fraud-04 |
| EXCEEDS_REMAINING_COVER | 30 | amount = remaining cover does not fire; remaining + 1 fires | TC-Fraud-05 |
| HIGH_VALUE_RATIO | 20 | exactly 80 % does not fire; 80 % + 1 fires | TC-Fraud-06 |
| EARLY_CLAIM | 25 | day 30 fires; day 31 does not | TC-Fraud-07 |
| FREQUENT_CLAIMS | 25 | 1 claim no; 2 claims yes; day 90 counts, day 91 does not; rejected excluded | TC-Fraud-08 |
| NO_SUPPORTING_DOCUMENTS | 15 | 0 documents (and the default argument) fires | TC-Fraud-09 |
| LATE_REPORTING | 10 | day 30 does not fire; day 31 fires | TC-Fraud-10 |
| Score and flag | — | score 50 is flagged; six rules firing total 165, capped at 100 | TC-Fraud-11 |

### 5.2 `src/modules/settlement.js`: `computeSettlement()`

Formula: `eligible = min(approved, sumInsured − alreadySettled)`, `afterDeductible = max(0, eligible − deductible)`, `payable = afterDeductible × (1 − copayRate)`.

| Case | Input | Expected payable | Test |
| --- | --- | --- | --- |
| Health | 90,000 on 100,000 | 76,500 (deductible 5,000, co-pay 8,500) | TC-Settle-02 |
| Motor / home / life | 50,000 / 50,000 / 1,000,000 | 47,500 / 40,000 / 1,000,000 | TC-Settle-03 |
| Capped by remaining cover | 30,000 after 76,500 paid on 100,000 | 16,650 (eligible 23,500) | TC-Settle-04 |
| Cover used up | already settled > sum insured | 0, remaining cover 0 (never negative) | TC-Settle-05 |
| Below deductible | 9,999.99 home | 0 | TC-Settle-05 |
| Rounding | 12,345.678 health | 6,611.11 | TC-Settle-06 |
| Unknown coverage | `travel` | throws | TC-Settle-07 |

The signed settlement letter that shows these figures is tested in TC-Settle-10..13.

### 5.3 `src/modules/notifications.js`

| Behaviour | Test |
| --- | --- |
| Channel choice: in-app always; email if on file; SMS if on file | TC-Notify-02, TC-Notify-03 |
| Unknown customer ignored | TC-Notify-04 |
| Agent copy for agent-managed customers | TC-Notify-05 |
| Provider failure: 3 attempts with backoff, then FAILED; other channels unaffected | TC-Notify-06 |
| Transient failure recovers on retry | TC-Notify-07 |
| Role broadcast skips inactive users | TC-Notify-08 |
| Inbox scoping and mark-as-read | TC-Notify-09 |
| Contact details that cannot be decrypted: channel FAILED, in-app still delivered, never rejects (DEF-01) | TC-Notify-10, TC-Notify-11 |

Provider outages are simulated by replacing the swappable provider adapters (`providers.email`, `providers.sms`) inside the test and restoring them afterwards.

### 5.4 `src/modules/claims.js`

Covered by TC-Claim-01..11, TC-WF-01..03, TC-Settle-01/08/09, TC-Contract-01..05, TC-Sec-Claim-01..07, TC-Notify-12 and TC-Track-01..05 (see [TEST_CASES.md](../TEST_CASES.md) §3.5, 3.7, 3.9–3.14): validation of every input field, document type checks, role-scoped listing, decision and settlement guards, the SAD API contract, RBAC and injection attempts, isolation from notification failures, and the three workflow event consumers.

### 5.5 `src/core/util.js`: `isIsoDate()` (shared)

TC-Date-01..03: real dates (including 29 February in leap years) accepted; impossible dates (2026-02-30, 2026-04-31, 2025-02-29, 1900-02-29) and wrong formats rejected (DEF-02).

## 6. Defects found by the unit tests

Each defect was reproduced with a failing test, committed, then fixed in a separate commit; the full suite was re-run after every fix. Details: [DEFECT_LOG.md](DEFECT_LOG.md).

| ID | Severity | Summary | Found by | Status |
| --- | --- | --- | --- | --- |
| DEF-01 | High | Server process crashes when a customer's contact details cannot be decrypted (unhandled promise rejection from notifications) | TC-Notify-10, TC-Notify-11 | Fixed, verified |
| DEF-02 | Medium | Impossible dates such as 2026-02-30 accepted as claim incident date / date of birth | TC-Date-02, TC-Claim-11 | Fixed, verified |
| DEF-03 | Low | Claim and approved amounts accept `true`, `[5]`, `"0x10"` through `Number()` coercion | TC-Sec-Claim-06, TC-Sec-Claim-07 | Fixed, verified |

Open defects at the end of the cycle: **0**.

## 7. Observations

Behaviour confirmed as intended and pinned by tests (details in the defect log, OBS-01..05):

1. Remaining cover is reduced by the amount paid, not the amount claimed.
2. EXCEEDS_REMAINING_COVER alone (30 points) does not reach the flag threshold of 50.
3. Claims with no documents are accepted and scored NO_SUPPORTING_DOCUMENTS (15).

## 8. Deviations from the test plan

| STP says | What was done | Reason |
| --- | --- | --- |
| JUnit + Jest | `node:test` | The project is Node.js; the built-in runner needs no extra dependency |
| Execution 02-11 to 06-11-2026 (Part-3 schedule) | Executed 17-11-2026 | Late; the code base also changed until 11-11-2026 (PRs #6–#8), so all tests were re-run on the latest `main` |
| Jira for defects | GitHub pull requests and [DEFECT_LOG.md](DEFECT_LOG.md) | Course instruction: no Jira |

The full list is in [DEVIATIONS.md](../DEVIATIONS.md) §6.

## 9. Evidence

- Full console output of the run: [evidence/test-run.txt](evidence/test-run.txt)
- Coverage table from the same run: [evidence/coverage-table.txt](evidence/coverage-table.txt)
- CI re-runs `npm test` (job "Build & Test") and `npm run test:coverage` (job "Coverage report (c8)") on Node 22 for every push and pull request (`.github/workflows/ci-cd-pipeline.yaml`).

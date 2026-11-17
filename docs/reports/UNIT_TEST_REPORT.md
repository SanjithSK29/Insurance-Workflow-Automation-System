# Unit Test Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Report | Unit Test Report (Deliverables Part-3, item 2.b.i) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Test plan | STP v1.0 §5 (unit level), test cases in [TEST_CASES.md](../TEST_CASES.md) |
| Build under test | `main` at `b4c18dd` (after PR #8) plus the new tests on branch `vishal-test-updates` |
| Executed on | 17-11-2026 (planned window 02-11 to 06-11-2026; see section 7) |
| Result | **86 / 86 automated tests passed, 0 failed, 0 skipped** |

## 1. Scope

The STP (§5) defines unit tests as module-level tests. In IWAS these are:

- **Pure unit tests:** functions called directly with no app, database or network: fraud rules, settlement formula, BPMN expression evaluator and validator, circuit breaker, retry, PDF writer, risk scoring, premium calculation.
- **Module tests through the API:** each service module (claims, notifications, policies, etc.) exercised through its HTTP routes against an isolated in-memory SQLite database. These also count towards the System Validation Report, which looks at them per requirement.

This report covers the whole suite, with detail on the QA Lead's modules (claims, fraud, settlement, notifications).

## 2. Environment

| Item | Value |
| --- | --- |
| OS | Windows 11 Home (local run); Ubuntu (GitHub Actions CI) |
| Runtime | Node.js v25.2.0 (local); Node.js 22 (CI) |
| Test runner | `node:test` (built into Node), `--test-concurrency=1` |
| Assertions | `node:assert/strict` |
| Coverage | c8 10.1.3 (V8 native coverage), `--all` so untested files count as 0 % |
| Database | SQLite in memory (`node:sqlite`), a new database per test file |
| Command | `npm test` (results) and `npm run test:coverage` (results + coverage) |

## 3. Summary

| Metric | Before (main, 17-11-2026) | After (this branch) |
| --- | --- | --- |
| Test files | 7 | 10 |
| Test suites | 11 | 15 |
| Test cases | 51 | 86 |
| Passed | 51 | 86 |
| Failed | 0 | 0 |
| Skipped / todo | 0 | 0 |
| Pass rate | 100 % | 100 % |
| Suite duration | about 14 s | about 14 s |

## 4. Results by test file

| Test file | Owner | Suite | Tests | Passed | Failed |
| --- | --- | --- | --- | --- | --- |
| quote-underwriting.test.js | Sanjith | Quote generation; Underwriting and KYC | 10 | 10 | 0 |
| policy.test.js | Samarth | Policy issuance and management | 6 | 6 | 0 |
| policy-cancellation.test.js | Sanjith | Policy cancellation and pro-rata refund | 2 | 2 | 0 |
| renewals-report.test.js | Sanjith | Renewals due report and pipeline metrics | 3 | 3 | 0 |
| admin-security.test.js | Sampreeth | Admin/RBAC; Security requirements; Authentication hardening | 17 | 17 | 0 |
| performance-unit.test.js | Vishal / shared | Performance; Unit: workflow, resilience, PDF | 6 | 6 | 0 |
| claims-workflow.test.js | Vishal | Claims processing and workflow | 7 | 7 | 0 |
| **fraud-settlement.test.js** (new) | Vishal | Fraud detection rules; Settlement formula | 16 | 16 | 0 |
| **claims-edge-cases.test.js** (new) | Vishal | Claims API edge cases | 11 | 11 | 0 |
| **notifications.test.js** (new) | Vishal | Notification service | 8 | 8 | 0 |
| **Total** | | | **86** | **86** | **0** |

(`test/helpers.js` is the shared harness, not a test file.)

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
| Score and flag | — | score 50 is flagged; all six rules total 165 and are capped at 100 | TC-Fraud-11 |

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

Provider outages are simulated by replacing the swappable provider adapters (`providers.email`, `providers.sms`) inside the test; they are restored after each test.

### 5.4 `src/modules/claims.js`

Covered by TC-Claim-01 to TC-Claim-10, TC-WF-01 to TC-WF-03, TC-Settle-01, TC-Settle-08, TC-Settle-09 (see [TEST_CASES.md](../TEST_CASES.md) §3.5 and §3.7): validation of every input field, document type sniffing, role-scoped listing, decision and settlement guards, and the three workflow event consumers.

## 6. Defects

| ID | Severity | Description | Status |
| --- | --- | --- | --- |
| — | — | No test failed, so no defects were raised in this cycle. | — |

Observations recorded instead of defects (behaviour is intended; see the RTM "Clarified behaviour" table):

1. Remaining cover is reduced by the amount paid, not the amount claimed.
2. EXCEEDS_REMAINING_COVER alone (30 points) does not reach the flag threshold of 50.
3. Claims with no documents are accepted and scored NO_SUPPORTING_DOCUMENTS (15).

## 7. Deviations from the test plan

| STP says | What was done | Reason |
| --- | --- | --- |
| JUnit + Jest | `node:test` | The project was built in Node.js; the built-in runner needs no extra dependency. |
| Execution 02-11 to 06-11-2026 (Part-3 schedule) | Executed 17-11-2026 | Late; the code base also changed up to 11-11-2026 (PRs #6–#8), so all tests were re-run on the latest `main`. |
| Jira for defects | GitHub (PRs, review comments) | Course instruction: no Jira. |

## 8. Evidence

- Full console output: [evidence/test-run.txt](evidence/test-run.txt)
- Coverage table from the same run: [evidence/coverage-table.txt](evidence/coverage-table.txt)
- CI re-runs `npm test` on Node 22 for every push and pull request (`.github/workflows/ci-cd-pipeline.yaml`, job "Build & Test").

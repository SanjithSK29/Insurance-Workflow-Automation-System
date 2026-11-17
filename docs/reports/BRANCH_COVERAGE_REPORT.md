# Branch Coverage Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Report | Branch Coverage Report (Deliverables Part-3, item 2.b.iv) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Tool | c8 10.1.3 (V8 native branch coverage), `.c8rc.json`, `npm run test:coverage` |
| Build under test | Branch `vishal-input-validation` (= `main` at `b4c18dd` + PR #9 + PR #10 + PR #11) |
| Executed on | 17-11-2026, Node.js v25.2.0, Windows 11; repeated in CI on Node.js 22 |
| Result | **82.18 % of branches covered (932 / 1134)**, up from 75.52 % (756 / 1001). CI fails below 80 %. |

## 1. What branch coverage measures here

A branch is one possible path out of a decision: each side of an `if`/`else`, each operand of `&&`, `||` and `??`, each side of a `? :`, and default parameter values. Statement coverage can be 100 % while a branch has never been taken. For example, `fraud.js` already had 100 % statement coverage, but 4 of its 15 branches had never run.

**Why the total number of branches changes between runs (1001 → 1059 → 1094 → 1134):** V8 records branches as code runs, so when tests reach code that never ran before (for example the `catch` block in `notifications.js`), the branches inside it are counted for the first time. The steps from 1059 to 1094 and to 1134 also include the new decisions added by the defect fixes (DEF-01..03 in PR #10, DEF-04..07 in PR #11).

## 2. Overall

| Run | Tests | Branches covered | Branch coverage |
| --- | --- | --- | --- |
| Baseline: `main` after PR #8 | 51 | 756 / 1001 | 75.52 % |
| After PR #9 (fraud/settlement unit tests, claims edge cases, notifications) | 86 | 848 / 1059 | 80.07 % |
| After PR #10 (contract, security, resilience, settlement letter, tracking, DEF-01..03) | 114 | 886 / 1094 | 80.98 % |
| Now: after PR #11 (shared numeric input rule, DEF-04..07 in quotes, customers, policies, admin) | 122 | **932 / 1134** | **82.18 %** |

176 more branches are covered than in the baseline.

## 3. QA Lead's modules

| Module | Baseline | Now | Not covered |
| --- | --- | --- | --- |
| `src/modules/claims.js` | 73.95 % (71 / 96) | **96.55 % (140 / 145)** | 5 defensive fallbacks (section 3.4) |
| `src/modules/fraud.js` | 73.33 % (11 / 15) | **100 % (17 / 17)** | — |
| `src/modules/settlement.js` | 66.66 % (2 / 3) | **100 % (4 / 4)** | — |
| `src/modules/notifications.js` | 77.77 % (14 / 18) | **100 % (31 / 31)** | — |

### 3.1 `fraud.js`

In the baseline, lines 17–18 (EXCEEDS_REMAINING_COVER), 23 (FREQUENT_CLAIMS) and 27 (LATE_REPORTING) never ran. The unit tests in `fraud-settlement.test.js` drive every decision both ways:

| Decision | Path tested | Covered by |
| --- | --- | --- |
| `priorClaims = []`, `documentsCount = 0` defaults | default value used | TC-Fraud-09 |
| `claim.amount > remainingCover` … `else if > 80 %` | EXCEEDS_REMAINING_COVER taken, so HIGH_VALUE_RATIO is skipped | TC-Fraud-05 |
| `recent.length >= 2` | true (FREQUENT_CLAIMS) | TC-Fraud-08 |
| `daysBetween(incident, reportedOn) > 30` | true (LATE_REPORTING) | TC-Fraud-10 |
| `score >= FLAG_THRESHOLD \|\| !!duplicate` | flagged by score without a duplicate | TC-Fraud-11 |

### 3.2 `settlement.js`

In the baseline, line 18 (the error for an unknown coverage type) never ran.

| Decision | Path tested | Covered by |
| --- | --- | --- |
| `if (!terms) throw` | unknown coverage type | TC-Settle-07 |
| `alreadySettled = 0` default | default used | TC-Settle-02, TC-Settle-03 |

### 3.3 `notifications.js`

In the baseline, lines 43–45 (provider failure) and 65–67 (mark as read) never ran. `readContact()` was added by the DEF-01 fix.

| Decision | Path tested | Covered by |
| --- | --- | --- |
| `if (!c) return` | unknown customer | TC-Notify-04 |
| `if (agentId)` | customer managed by an agent | TC-Notify-05 |
| `if (email)` / `if (phone)` | contact detail missing | TC-Notify-03 |
| `try … catch` around `retry(send)` | provider fails 3 times, stored as FAILED | TC-Notify-06 |
| retry succeeds after a failure | second attempt succeeds | TC-Notify-07 |
| `readContact()` `try … catch` | contact cannot be decrypted, channel FAILED, no rejection | TC-Notify-10, TC-Notify-11 |
| `if (!r.changes) throw notFound` | both sides of mark-as-read | TC-Notify-09 |

### 3.4 `claims.js`

Decisions driven by the new tests (in the baseline, lines 224–229 and 246–250 never ran):

| Decision | Covered by |
| --- | --- |
| `documents` not an array; more than 10; empty file; unknown MIME; content does not match MIME (PNG, JPEG checks) | TC-Claim-05, TC-Claim-06 |
| `d.filename` missing, so `document-N` is used; unsafe characters replaced | TC-Claim-06, TC-Sec-Claim-05 |
| `policy.status !== 'ACTIVE'` | TC-Claim-04 |
| amount not a real number or ≤ 0; date not a real ISO date; date before policy start | TC-Claim-03, TC-Claim-11, TC-Sec-Claim-06 |
| amounts parsed with the shared `parseNumber()` (DEF-03; the helper's own branches, including the non-finite case, are in `util.js` and covered by TC-Num-01/02) | TC-Sec-Claim-06, TC-Sec-Claim-07 |
| `notifyClaimant()`: synchronous throw and rejected promise both caught (DEF-01) | TC-Notify-12 |
| `body.description` present vs absent | TC-Claim-06 |
| `fraud.flagged` true, so ETA "10 days" | TC-Settle-09 |
| listing for CUSTOMER / AGENT / staff with status / staff without status | TC-Claim-07, TC-Claim-08 |
| `['SETTLED','REJECTED'].includes(status)` on document upload | TC-Claim-09 |
| decision: claim not found; no task for role; `approvedAmount` empty, negative, too high, not a number | TC-WF-03, TC-Sec-Claim-07 |
| settle: claim not found; not approved | TC-Settle-08 |
| `claim.approved_amount ?? claim.amount` both sides | TC-WF-03, TC-Settle-01 |
| event consumers: other process; unknown claim; `approvedAmount` undefined; clamping above, below and non-numeric | TC-Claim-10 |

The 5 branches still not covered:

| Line | Code | Why it is not reached |
| --- | --- | --- |
| 28 | `s?.payableAmount ?? ''` in the APPROVED message | APPROVED is always set together with a settlement, so the `?? ''` fallback never runs |
| 30 | same fallback in the SETTLED message | Same reason |
| 69 | `parseJson(r.settlement, {}).payableAmount \|\| 0` | Every SETTLED claim stores a settlement with `payableAmount` |
| 228 | `req.body \|\| {}` in `POST /claims` | `express.json()` always sets `req.body` |
| 267 | `req.body \|\| {}` in `POST /claims/:id/decision` | Same reason |

They protect against corrupted data or a misconfigured server rather than implementing features. Covering them would mean writing broken rows straight into the database or bypassing Express, so they are left as they are.

## 4. All files

| File | Branches | Coverage |
| --- | --- | --- |
| src/app.js | 13 / 13 | 100 % |
| src/core/config.js | 2 / 2 | 100 % |
| src/core/db.js | 15 / 16 | 93.75 % |
| src/core/errors.js | 16 / 20 | 80 % |
| src/core/events.js | 5 / 7 | 71.42 % |
| src/core/logger.js | 7 / 9 | 77.77 % |
| src/core/resilience.js | 21 / 21 | 100 % |
| src/core/util.js | 30 / 33 | 90.9 % |
| src/modules/admin.js | 33 / 44 | 75 % |
| **src/modules/claims.js** | **140 / 145** | **96.55 %** |
| src/modules/customers.js | 78 / 103 | 75.72 % |
| src/modules/documents.js | 16 / 21 | 76.19 % |
| **src/modules/fraud.js** | **17 / 17** | **100 %** |
| **src/modules/notifications.js** | **31 / 31** | **100 %** |
| src/modules/payments.js | 34 / 44 | 77.27 % |
| src/modules/pdf.js | 21 / 26 | 80.76 % |
| src/modules/policies.js | 68 / 83 | 81.92 % |
| src/modules/quotes.js | 52 / 61 | 85.24 % |
| **src/modules/settlement.js** | **4 / 4** | **100 %** |
| src/modules/underwriting.js | 61 / 84 | 72.61 % |
| src/modules/users.js | 32 / 56 | 57.14 % |
| src/security/audit.js | 15 / 20 | 75 % |
| src/security/auth.js | 30 / 37 | 81.08 % |
| src/security/crypto.js | 13 / 16 | 81.25 % |
| src/security/middleware.js | 28 / 31 | 90.32 % |
| src/security/pii.js | 14 / 16 | 87.5 % |
| src/seed.js | 1 / 1 | 100 % |
| src/server.js | 2 / 3 | 66.66 % |
| src/workflow/bpmn.js | 44 / 60 | 73.33 % |
| src/workflow/engine.js | 38 / 50 | 76 % |
| src/workflow/expression.js | 51 / 60 | 85 % |
| **Total** | **932 / 1134** | **82.18 %** |

## 5. Lowest branch coverage, for the module owners

These files are outside the QA Lead's modules. They are listed so the owners can add tests in a later cycle:

| File | Branch coverage | Owner (docs/WORK_SPLIT.md) |
| --- | --- | --- |
| users.js | 57.14 % | Sampreeth |
| events.js | 71.42 % | Sampreeth |
| underwriting.js | 72.61 % | Sanjith |
| bpmn.js | 73.33 % | Sanjith |
| admin.js | 75 % | Sampreeth |
| customers.js | 75.72 % | Sanjith |

## 6. How to reproduce

```bash
npm ci
npm run test:coverage
```

The run fails if branch coverage drops below 80 % (`.c8rc.json`). The baseline (756 / 1001) was measured on commit `b4c18dd`. To measure it, check out that commit and run c8 on the seven original test files (`--check-coverage=false` because the baseline is below today's minimum). On today's code (PR #11) the same command gives 75.41 % (764 / 1013), slightly different because the defect fixes added code.

```bash
npx c8 --check-coverage=false --reporter=text-summary node --test --test-concurrency=1 test/admin-security.test.js test/claims-workflow.test.js test/performance-unit.test.js test/policy-cancellation.test.js test/policy.test.js test/quote-underwriting.test.js test/renewals-report.test.js
```

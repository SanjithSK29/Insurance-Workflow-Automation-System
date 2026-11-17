# Branch Coverage Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Report | Branch Coverage Report (Deliverables Part-3, item 2.b.iv) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Tool | c8 10.1.3 (V8 native branch coverage), `npm run test:coverage` |
| Build under test | `main` at `b4c18dd` plus the new tests on branch `vishal-test-updates` |
| Executed on | 17-11-2026, Node.js v25.2.0, Windows 11 |
| Result | **80.07 % of branches covered (848 / 1059)**, up from 75.52 % (756 / 1001) |

## 1. What branch coverage measures here

A branch is one possible path out of a decision: each side of an `if`/`else`, each operand of `&&`, `||` and `??`, each side of a `? :`, each `case`, and default parameter values. Statement coverage can be 100 % while a branch is never taken. For example, `fraud.js` already had 100 % statement coverage, but 4 of its 15 branches had never run.

**Why the total number of branches changed (1001 → 1059):** V8 records branches as it runs code, so when new tests reach paths that never ran before (for example the `catch` block in `notifications.js`), V8 counts the branches inside those paths too. Both runs measured the same source code; only the tests differ.

## 2. Overall

| Run | Tests | Branches covered | Branch coverage |
| --- | --- | --- | --- |
| Before: `main` after PR #8 | 51 | 756 / 1001 | 75.52 % |
| After: + 3 new test files | 86 | 848 / 1059 | **80.07 %** |

92 more branches are now covered.

## 3. QA Lead's modules

| Module | Before | After | Uncovered after |
| --- | --- | --- | --- |
| `src/modules/claims.js` | 73.95 % (71 / 96) | **96.18 % (126 / 131)** | 5 defensive fallbacks (section 3.4) |
| `src/modules/fraud.js` | 73.33 % (11 / 15) | **100 % (17 / 17)** | — |
| `src/modules/settlement.js` | 66.66 % (2 / 3) | **100 % (4 / 4)** | — |
| `src/modules/notifications.js` | 77.77 % (14 / 18) | **100 % (29 / 29)** | — |

### 3.1 `fraud.js`

Before, c8 reported lines 17–18 (EXCEEDS_REMAINING_COVER), 23 (FREQUENT_CLAIMS) and 27 (LATE_REPORTING) as never run. The new unit tests drive every decision both ways:

| Decision | Path tested | Covered by |
| --- | --- | --- |
| `priorClaims = []`, `documentsCount = 0` defaults | default value used | TC-Fraud-09 |
| `claim.amount > remainingCover` … `else if > 80 %` | EXCEEDS_REMAINING_COVER taken, so HIGH_VALUE_RATIO skipped | TC-Fraud-05 |
| `recent.length >= 2` | true side (FREQUENT_CLAIMS) | TC-Fraud-08 |
| `daysBetween(incident, reportedOn) > 30` | true side (LATE_REPORTING) | TC-Fraud-10 |
| `score >= FLAG_THRESHOLD \|\| !!duplicate` | flagged by score without a duplicate | TC-Fraud-11 |
| `Math.min(100, …)` cap | score above 100 | TC-Fraud-11 |

### 3.2 `settlement.js`

Before, line 18 (the error for an unknown coverage type) never ran.

| Decision | Path tested | Covered by |
| --- | --- | --- |
| `if (!terms) throw` | unknown coverage type | TC-Settle-07 |
| `alreadySettled = 0` default | default used | TC-Settle-02, TC-Settle-03 |

### 3.3 `notifications.js`

Before, lines 43–45 (provider failure) and 65–67 (mark as read) never ran.

| Decision | Path tested | Covered by |
| --- | --- | --- |
| `if (!c) return` | unknown customer | TC-Notify-04 |
| `if (agentId)` | customer has an agent | TC-Notify-05 |
| `if (email)` / `if (phone)` | contact detail missing | TC-Notify-03 |
| `try … catch` around `retry(send)` | provider fails 3 times, row stored as FAILED | TC-Notify-06 |
| retry succeeds after a failure | second attempt succeeds | TC-Notify-07 |
| `if (!r.changes) throw notFound` | both sides of mark-as-read | TC-Notify-09 |

### 3.4 `claims.js`: branches added, and the 5 that remain

Decisions the new tests drive (before, lines 224–229 and 246–250 never ran):

| Decision | Covered by |
| --- | --- |
| `documents` not an array; more than 10; empty file; unknown MIME; content does not match MIME (PNG, JPEG checks) | TC-Claim-05, TC-Claim-06 |
| `d.filename` missing, so `document-N` is used; unsafe characters replaced | TC-Claim-06 |
| `policy.status !== 'ACTIVE'` | TC-Claim-04 |
| amount not finite or ≤ 0; date not ISO; date before policy start | TC-Claim-03 |
| `body.description` present vs absent | TC-Claim-06 |
| `fraud.flagged` true, so ETA "10 days" | TC-Settle-09 |
| listing for CUSTOMER / AGENT / staff with status / staff without status | TC-Claim-07, TC-Claim-08 |
| `['SETTLED','REJECTED'].includes(status)` on document upload | TC-Claim-09 |
| decision: claim not found; no task for role; `approvedAmount` empty, negative, too high, not a number | TC-WF-03 |
| settle: claim not found; not approved | TC-Settle-08 |
| `claim.approved_amount ?? claim.amount` both sides | TC-WF-03, TC-Settle-01 |
| event consumers: other process; unknown claim; `approvedAmount` undefined; clamping above, below and non-numeric | TC-Claim-10 |
| `claim.status === 'REGISTERED'` false when the senior task is created | TC-WF-01 |

The 5 branches still not covered are defensive fallbacks that normal API use cannot reach:

| Line | Code | Why it is not reached |
| --- | --- | --- |
| 28 | `` `…INR ${s?.payableAmount ?? ''}` `` (APPROVED message) | The APPROVED status is always set together with a settlement, so the `?? ''` fallback never runs |
| 30 | same fallback in the SETTLED message | Same reason |
| 61 | `parseJson(r.settlement, {}).payableAmount \|\| 0` | Every SETTLED claim stores a settlement with `payableAmount` |
| 220 | `req.body \|\| {}` in `POST /claims` | `express.json()` always sets `req.body` |
| 259 | `req.body \|\| {}` in `POST /claims/:id/decision` | Same reason |

Covering these would mean writing corrupted rows straight into the database or bypassing Express. They protect against bad data rather than implementing features, so they are left as they are.

## 4. All files

| File | Branches | Coverage |
| --- | --- | --- |
| src/app.js | 13 / 13 | 100 % |
| src/seed.js | 1 / 1 | 100 % |
| src/server.js | 2 / 3 | 66.66 % |
| src/core/config.js | 2 / 2 | 100 % |
| src/core/db.js | 15 / 16 | 93.75 % |
| src/core/errors.js | 15 / 20 | 75 % |
| src/core/events.js | 5 / 7 | 71.42 % |
| src/core/logger.js | 7 / 9 | 77.77 % |
| src/core/resilience.js | 21 / 21 | 100 % |
| src/core/util.js | 17 / 20 | 85 % |
| src/modules/admin.js | 29 / 41 | 70.73 % |
| **src/modules/claims.js** | **126 / 131** | **96.18 %** |
| src/modules/customers.js | 53 / 79 | 67.08 % |
| src/modules/documents.js | 12 / 18 | 66.66 % |
| **src/modules/fraud.js** | **17 / 17** | **100 %** |
| **src/modules/notifications.js** | **29 / 29** | **100 %** |
| src/modules/payments.js | 34 / 44 | 77.27 % |
| src/modules/pdf.js | 21 / 26 | 80.76 % |
| src/modules/policies.js | 60 / 77 | 77.92 % |
| src/modules/quotes.js | 44 / 55 | 80 % |
| **src/modules/settlement.js** | **4 / 4** | **100 %** |
| src/modules/underwriting.js | 61 / 84 | 72.61 % |
| src/modules/users.js | 32 / 56 | 57.14 % |
| src/security/audit.js | 15 / 20 | 75 % |
| src/security/auth.js | 26 / 34 | 76.47 % |
| src/security/crypto.js | 12 / 15 | 80 % |
| src/security/middleware.js | 28 / 31 | 90.32 % |
| src/security/pii.js | 14 / 16 | 87.5 % |
| src/workflow/bpmn.js | 44 / 60 | 73.33 % |
| src/workflow/engine.js | 38 / 50 | 76 % |
| src/workflow/expression.js | 51 / 60 | 85 % |
| **Total** | **848 / 1059** | **80.07 %** |

## 5. Lowest branch coverage, for the module owners

These files are outside the QA Lead's modules. They are listed so their owners can add tests in a later cycle:

| File | Branch coverage | Owner (docs/WORK_SPLIT.md) |
| --- | --- | --- |
| users.js | 57.14 % | Sampreeth |
| documents.js | 66.66 % | Samarth |
| customers.js | 67.08 % | Sanjith |
| admin.js | 70.73 % | Sampreeth |
| underwriting.js | 72.61 % | Sanjith |
| bpmn.js | 73.33 % | Sanjith |

## 6. How to reproduce

```bash
npm ci
npm run test:coverage
```

To reproduce the "before" figure, run c8 on the seven original test files only:

```bash
npx c8 --all --src src --reporter=text-summary node --test --test-concurrency=1 test/admin-security.test.js test/claims-workflow.test.js test/performance-unit.test.js test/policy-cancellation.test.js test/policy.test.js test/quote-underwriting.test.js test/renewals-report.test.js
```

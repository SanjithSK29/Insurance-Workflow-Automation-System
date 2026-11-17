# Code Coverage Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Report | Code Coverage Report (Deliverables Part-3, item 2.b.iii) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Tool | c8 10.1.3 (V8 native coverage), configured in `.c8rc.json`, run as `npm run test:coverage` |
| Scope | Every file under `src/` (`all: true`, so files no test loads still count) |
| Build under test | Branch `vishal-input-validation` (= `main` at `b4c18dd` + PR #9 + PR #10 + PR #11) |
| Executed on | 17-11-2026, Node.js v25.2.0, Windows 11; repeated by the CI job "Coverage report (c8)" on Node.js 22 |
| Result | **94.68 % statements, 93.53 % functions, 94.68 % lines** (branches: [Branch Coverage Report](BRANCH_COVERAGE_REPORT.md)) |

## 1. Overall

| Metric | Baseline: `main`, 51 tests | After PR #9: 86 tests | After PR #10: 114 tests | Now (PR #11): 122 tests | CI minimum |
| --- | --- | --- | --- | --- | --- |
| Statements | 93.65 % (3205 / 3422) | 94.15 % (3222 / 3422) | 94.3 % (3262 / 3459) | **94.68 % (3276 / 3460)** | 93 % |
| Functions | 91.7 % (210 / 229) | 93.01 % (213 / 229) | 93.53 % (217 / 232) | **93.53 % (217 / 232)** | 92 % |
| Lines | 93.65 % (3205 / 3422) | 94.15 % (3222 / 3422) | 94.3 % (3262 / 3459) | **94.68 % (3276 / 3460)** | 93 % |
| Branches | 75.52 % (756 / 1001) | 80.07 % (848 / 1059) | 80.98 % (886 / 1094) | **82.18 % (932 / 1134)** | 80 % |

All three runs used the same command on the same machine on 17-11-2026. The source grew by 37 statements between PR #9 and PR #10 because of the three defect fixes (see [DEFECT_LOG.md](DEFECT_LOG.md)); the new code is fully covered. PR #11 moved the claims amount parser into the shared `parseNumber()` in `util.js` and used it in quotes, customers, policies and admin (DEF-04..07); its new tests also cover the customer profile update, which raised `customers.js` from 83.74 % to 90.14 % of statements.

## 2. By file

| File | Statements | Functions | Lines |
| --- | --- | --- | --- |
| src/app.js | 100 % (108/108) | 100 % (3/3) | 100 % (108/108) |
| src/core/config.js | 100 % (43/43) | 100 % (1/1) | 100 % (43/43) |
| src/core/db.js | 99.07 % (320/323) | 100 % (10/10) | 99.07 % (320/323) |
| src/core/errors.js | 100 % (35/35) | 100 % (9/9) | 100 % (35/35) |
| src/core/events.js | 90.32 % (28/31) | 75 % (3/4) | 90.32 % (28/31) |
| src/core/logger.js | 85.18 % (23/27) | 75 % (6/8) | 85.18 % (23/27) |
| src/core/resilience.js | 100 % (57/57) | 100 % (5/5) | 100 % (57/57) |
| src/core/util.js | 96.36 % (53/55) | 100 % (12/12) | 96.36 % (53/55) |
| src/modules/admin.js | 99.35 % (153/154) | 90.9 % (10/11) | 99.35 % (153/154) |
| **src/modules/claims.js** | **100 % (283/283)** | **100 % (19/19)** | **100 % (283/283)** |
| src/modules/customers.js | 90.14 % (183/203) | 90 % (9/10) | 90.14 % (183/203) |
| src/modules/documents.js | 100 % (99/99) | 100 % (5/5) | 100 % (99/99) |
| **src/modules/fraud.js** | **100 % (33/33)** | **100 % (2/2)** | **100 % (33/33)** |
| **src/modules/notifications.js** | **100 % (84/84)** | **100 % (8/8)** | **100 % (84/84)** |
| src/modules/payments.js | 96.51 % (166/172) | 100 % (15/15) | 96.51 % (166/172) |
| src/modules/pdf.js | 90.8 % (79/87) | 100 % (3/3) | 90.8 % (79/87) |
| src/modules/policies.js | 97.92 % (283/289) | 100 % (13/13) | 97.92 % (283/289) |
| src/modules/quotes.js | 86.87 % (139/160) | 57.14 % (8/14) | 86.87 % (139/160) |
| **src/modules/settlement.js** | **100 % (34/34)** | **100 % (1/1)** | **100 % (34/34)** |
| src/modules/underwriting.js | 98.86 % (174/176) | 100 % (8/8) | 98.86 % (174/176) |
| src/modules/users.js | 97.41 % (151/155) | 80 % (4/5) | 97.41 % (151/155) |
| src/security/audit.js | 100 % (58/58) | 100 % (5/5) | 100 % (58/58) |
| src/security/auth.js | 98.21 % (110/112) | 92.3 % (12/13) | 98.21 % (110/112) |
| src/security/crypto.js | 91.66 % (44/48) | 100 % (7/7) | 91.66 % (44/48) |
| src/security/middleware.js | 97.61 % (82/84) | 100 % (4/4) | 97.61 % (82/84) |
| src/security/pii.js | 100 % (28/28) | 100 % (7/7) | 100 % (28/28) |
| src/seed.js | 30.18 % (16/53) | 0 % (0/1) | 30.18 % (16/53) |
| src/server.js | 39.65 % (23/58) | 50 % (1/2) | 39.65 % (23/58) |
| src/workflow/bpmn.js | 96.52 % (111/115) | 100 % (4/4) | 96.52 % (111/115) |
| src/workflow/engine.js | 90.64 % (184/203) | 100 % (11/11) | 90.64 % (184/203) |
| src/workflow/expression.js | 98.92 % (92/93) | 100 % (12/12) | 98.92 % (92/93) |
| **Total** | **94.68 % (3276/3460)** | **93.53 % (217/232)** | **94.68 % (3276/3460)** |

Bold rows are the QA Lead's modules. Uncovered line numbers for every file are in [evidence/coverage-table.txt](evidence/coverage-table.txt).

## 3. QA Lead's modules

| Module | Statements: baseline → now | Functions: baseline → now |
| --- | --- | --- |
| claims.js | 96 % (264/275) → **100 % (283/283)** | 88.88 % (16/18) → **100 % (19/19)** |
| fraud.js | 100 % → **100 %** | 100 % → **100 %** |
| settlement.js | 100 % → **100 %** | 100 % → **100 %** |
| notifications.js | 91.54 % (65/71) → **100 % (84/84)** | 100 % (7/7) → **100 % (8/8)** |

Lines that never ran in the baseline and are now covered:

- `claims.js` claim listing per role (customer, agent, staff with and without a status filter): TC-Claim-07, TC-Claim-08.
- `claims.js` adding documents to an existing claim: TC-Claim-09.
- `notifications.js` a provider failing on every retry, stored as FAILED: TC-Notify-06.
- `notifications.js` the mark-as-read endpoint, success and 404: TC-Notify-09.

New code added by the defect fixes, all covered:

- `notifications.js` `readContact()` (DEF-01): TC-Notify-10, TC-Notify-11.
- `claims.js` `notifyClaimant()` (DEF-01 hardening): TC-Notify-12.
- `util.js` `parseNumber()` (DEF-03, shared since PR #11 for DEF-04..07): TC-Num-01/02, TC-Sec-Claim-06/07, TC-Quote-06/07, TC-KYC-03/04, TC-Endorse-02, TC-Admin-02.
- `util.js` stricter `isIsoDate()` (DEF-02): TC-Date-01..03, TC-Claim-11.

`documents.js` also reached 100 % because the settlement-letter tests download the signed PDF (TC-Settle-10..13).

## 4. What is not covered, and why

| Area | Reason | Mitigation |
| --- | --- | --- |
| `server.js` (process start-up, HTTPS options, scheduler loop) | Tests build the app with `createApp()` and do not start the real process | The CI "Build & Test" job starts `npm start` and the Docker image and checks `/health`; TLS settings are covered by TC-Sec-TLS-01 |
| `seed.js` | Demo data only, switched off in tests (`seedDemoData: false`) | Exercised in the manual smoke run (`SEED_DEMO=true`) |
| `customers.js` agent bulk onboarding (`POST /customers/bulk`), customer listing, missing Aadhaar/PAN before KYC | No test yet (owner: Sanjith) | Follow-up for the owner |
| `quotes.js` quote listing (`GET /quote`), quote lookup (`GET /quote/:id`), oldest age band | No test yet (owner: Sanjith) | Follow-up for the owner |

## 5. Keeping the numbers true

Coverage is now checked automatically:

- `.c8rc.json` turns on `check-coverage` with minimums of statements 93 %, branches 80 %, functions 92 %, lines 93 %. `npm run test:coverage` exits with an error if a change drops below them (checked: exit 0 now, exit 1 with branches temporarily set to 99).
- The CI job **"Coverage report (c8)"** runs this on Node.js 22 for every push and pull request, writes the coverage table to the job summary and uploads the HTML report as the `coverage-report` artifact.

## 6. How to reproduce

```bash
npm ci
npm run test:coverage
```

This prints the table, writes `coverage/index.html` (ignored by git) and `coverage/coverage-summary.json`. The console output of the run behind this report is in [evidence/coverage-table.txt](evidence/coverage-table.txt).

## 7. Assessment against the test plan

The STP sets no numeric coverage target; its exit criteria (100 % of planned tests executed, 0 critical defects open, acceptance criteria met) are met. Every module the QA Lead owns has 100 % statement and function coverage, overall statement coverage is 94.68 %, and CI now prevents it from silently dropping.

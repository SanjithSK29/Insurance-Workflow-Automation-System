# Code Coverage Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Report | Code Coverage Report (Deliverables Part-3, item 2.b.iii) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Tool | c8 10.1.3 (V8 native coverage), run as `npm run test:coverage` |
| Scope | Every file under `src/` (`--all`, so files no test loads still count) |
| Build under test | `main` at `b4c18dd` plus the new tests on branch `vishal-test-updates` |
| Executed on | 17-11-2026, Node.js v25.2.0, Windows 11 |
| Result | **94.15 % statements, 93.01 % functions, 94.15 % lines** (branches: see the [Branch Coverage Report](BRANCH_COVERAGE_REPORT.md)) |

## 1. Overall

| Metric | Before (main, 51 tests) | After (86 tests) | Change |
| --- | --- | --- | --- |
| Statements | 93.65 % (3205 / 3422) | **94.15 % (3222 / 3422)** | +0.50 |
| Functions | 91.70 % (210 / 229) | **93.01 % (213 / 229)** | +1.31 |
| Lines | 93.65 % (3205 / 3422) | **94.15 % (3222 / 3422)** | +0.50 |
| Branches | 75.52 % (756 / 1001) | **80.07 % (848 / 1059)** | +4.55 |

Both runs use the same command on the same machine on 17-11-2026. The "before" run is `main` after PR #8; the "after" run adds only the three new test files.

## 2. By file

| File | Statements | Functions | Lines | Uncovered lines |
| --- | --- | --- | --- | --- |
| **src/** | | | | |
| app.js | 100 % (108/108) | 100 % (3/3) | 100 % | — |
| seed.js | 30.18 % (16/53) | 0 % (0/1) | 30.18 % | 15–51 (demo data, not used by tests) |
| server.js | 39.65 % (23/58) | 50 % (1/2) | 39.65 % | 20–49, 52–56 (process start-up, scheduler; covered by the CI smoke test) |
| **src/core/** | | | | |
| config.js | 100 % (43/43) | 100 % (1/1) | 100 % | — |
| db.js | 99.07 % (320/323) | 100 % (10/10) | 99.07 % | 312–314 |
| errors.js | 100 % (35/35) | 100 % (9/9) | 100 % | — |
| events.js | 90.32 % (28/31) | 75 % (3/4) | 90.32 % | 19–21 |
| logger.js | 85.18 % (23/27) | 75 % (6/8) | 85.18 % | 12–15 |
| resilience.js | 100 % (57/57) | 100 % (5/5) | 100 % | — |
| util.js | 94.73 % (36/38) | 100 % (11/11) | 94.73 % | 34–35 |
| **src/modules/** | | | | |
| admin.js | 99.35 % (153/154) | 90.9 % (10/11) | 99.35 % | 135 |
| **claims.js** | **100 % (275/275)** | **100 % (18/18)** | **100 %** | — |
| customers.js | 83.74 % (170/203) | 90 % (9/10) | 83.74 % | 123–124, 146–155, 159–164, 170–182 and others |
| documents.js | 96.96 % (96/99) | 100 % (5/5) | 96.96 % | 69–71 |
| **fraud.js** | **100 % (33/33)** | **100 % (2/2)** | **100 %** | — |
| **notifications.js** | **100 % (71/71)** | **100 % (7/7)** | **100 %** | — |
| payments.js | 96.51 % (166/172) | 100 % (15/15) | 96.51 % | 34–35, 164–167 |
| pdf.js | 90.8 % (79/87) | 100 % (3/3) | 90.8 % | 43–47, 51–53 |
| policies.js | 97.92 % (283/289) | 100 % (13/13) | 97.92 % | 120–123, 257–258 |
| quotes.js | 86.87 % (139/160) | 57.14 % (8/14) | 86.87 % | 23, 91–92, 121–123, 136–145, 149–153 |
| **settlement.js** | **100 % (34/34)** | **100 % (1/1)** | **100 %** | — |
| underwriting.js | 98.86 % (174/176) | 100 % (8/8) | 98.86 % | 121, 148 |
| users.js | 97.41 % (151/155) | 80 % (4/5) | 97.41 % | 135–138 |
| **src/security/** | | | | |
| audit.js | 100 % (58/58) | 100 % (5/5) | 100 % | — |
| auth.js | 98.21 % (110/112) | 92.3 % (12/13) | 98.21 % | 46–47 |
| crypto.js | 91.66 % (44/48) | 85.71 % (6/7) | 91.66 % | 12–13, 39–40 |
| middleware.js | 97.61 % (82/84) | 100 % (4/4) | 97.61 % | 78–79 |
| pii.js | 100 % (28/28) | 100 % (7/7) | 100 % | — |
| **src/workflow/** | | | | |
| bpmn.js | 96.52 % (111/115) | 100 % (4/4) | 96.52 % | 87–88, 92–93 |
| engine.js | 90.64 % (184/203) | 100 % (11/11) | 90.64 % | 142–146, 150, 154–160, 188–189 and others |
| expression.js | 98.92 % (92/93) | 100 % (12/12) | 98.92 % | 44 |

Bold rows are the QA Lead's modules.

## 3. QA Lead's modules: before and after

| Module | Statements before → after | Functions before → after |
| --- | --- | --- |
| claims.js | 96.00 % → **100 %** | 88.88 % → **100 %** |
| fraud.js | 100 % → **100 %** | 100 % → **100 %** |
| settlement.js | 100 % → **100 %** | 100 % → **100 %** |
| notifications.js | 91.54 % → **100 %** | 100 % → **100 %** |

The lines that were uncovered before and are now covered:

- `claims.js` 224–229: claim listing for AGENT, for staff with a `status` filter, and for staff without one (TC-Claim-07, TC-Claim-08).
- `claims.js` 246–250: adding documents to an existing claim (TC-Claim-09).
- `notifications.js` 43–45: a provider failing on every retry, recorded as FAILED (TC-Notify-06).
- `notifications.js` 65–67: the mark-as-read endpoint, both the success path and the 404 for an unknown or someone else's notification (TC-Notify-09).

## 4. What is not covered, and why

| Area | Reason | Mitigation |
| --- | --- | --- |
| `server.js` (process start-up, HTTPS options, scheduler loop) | Tests build the app with `createApp()` and do not start the real process | CI smoke test starts `npm start` and the Docker image and checks `/health`; TLS settings are covered by TC-Sec-TLS-01 |
| `seed.js` | Demo data only, switched off in tests (`seedDemoData: false`) | Exercised manually in the smoke run (`SEED_DEMO=true`) |
| `customers.js` agent bulk onboarding (`POST /customers/bulk`), customer listing, profile update (`PATCH /customers/:id`), missing Aadhaar/PAN before KYC | No test yet (owner: Sanjith) | Follow-up for the owner |
| `quotes.js` quote listing (`GET /quote`) and quote lookup (`GET /quote/:id`), oldest age band | No test yet (owner: Sanjith) | Follow-up for the owner |

## 5. How to reproduce

```bash
npm ci
npm run test:coverage
```

This prints the table above and writes an HTML report to `coverage/index.html` (ignored by git). The console output of this run is saved in [evidence/coverage-table.txt](evidence/coverage-table.txt).

## 6. Assessment against the test plan

The STP sets no numeric coverage target. Its exit criteria (100 % of planned tests executed, 0 critical defects, acceptance criteria met) are met. As a team target for the demo, every module the QA Lead owns is now at 100 % statement and function coverage, and overall statement coverage is above 94 %.

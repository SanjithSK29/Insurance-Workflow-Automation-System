# Test Reports (Deliverables Part-3)

Testing according to the STP, executed on 17-11-2026 by Sakaray Vishal (QA Lead), followed the same day by the Developer Lead's cycle for his modules (Samarth A). End of day: 154 / 154 tests passing, 14 defects found and fixed. Final run (19-11-2026): 171 / 171 passing, 17 defects found and fixed; each of the four Part-3 reports opens with a "Final run" section.

| Report | Headline |
| --- | --- |
| [Unit Test Report](UNIT_TEST_REPORT.md) | 122 / 122 tests passed in 17 files, 0 failed |
| [System Validation Report](SYSTEM_VALIDATION_REPORT.md) | All 18 functional and 5 security requirements pass end to end; NFR checks needing a deployed environment are listed |
| [Code Coverage Report](CODE_COVERAGE_REPORT.md) | 94.68 % statements, 93.53 % functions, 94.68 % lines |
| [Branch Coverage Report](BRANCH_COVERAGE_REPORT.md) | 82.18 % branches (932 / 1134), up from 75.52 % |
| [Test Summary Report](TEST_SUMMARY_REPORT.md) | STP §8 summary: results, metrics, exit criteria |
| [Developer Lead Report](DEV_LEAD_REPORT.md) | Policies, payments, documents and web UI: 32 new cases, DEF-08..14 fixed, module branch coverage 92–95 %, 0 WCAG A/AA violations (Samarth) |
| [Code Review Log](CODE_REVIEW_LOG.md) | Developer Lead's review of PRs #6–#13: verdicts, notes and follow-ups (Samarth) |
| [Defect Log](DEFECT_LOG.md) | 17 defects found (4 High, 9 Medium, 4 Low), all fixed and re-tested: DEF-01..07 by the QA Lead, DEF-08..14 by the Developer Lead, DEF-15..16 in the Sprint 4 changes, DEF-17 found while recording the Sprint 2 video |

Related: [Test Plan v1.1](../STP_v1.1.md) · [Test Case Document](../TEST_CASES.md) · [Requirements Traceability Matrix](../TRACEABILITY.md) · [Deviations](../DEVIATIONS.md) · raw output in [evidence/](evidence/)

Reproduce with `npm ci && npm run test:coverage` (fails if coverage drops below 93 % statements / 80 % branches). CI runs the same command in the "Coverage report (c8)" job and attaches the HTML report.

## Other final deliverables

| Deliverable | Location |
| --- | --- |
| Updated IEEE-format SRS, SAD and Test Plan (v2.0, as built) | [SRS](../ieee/SRS_v2.0.pdf) · [SAD](../ieee/SAD_v2.0.pdf) · [Test Plan](../ieee/STP_v2.0.pdf) (sources in `docs/ieee/src`) |
| Sprint 1 (1 min) and Sprint 2 (2 min) outcome videos | [docs/videos](../videos/) |
| Updated test cases | [TEST_CASES.md](../TEST_CASES.md) |
| Raw output of the final run | [evidence/final-test-run.txt](evidence/final-test-run.txt) |


# Test Reports (Deliverables Part-3)

Testing according to the STP, executed on 17-11-2026 by Sakaray Vishal (QA Lead).

| Report | Headline |
| --- | --- |
| [Unit Test Report](UNIT_TEST_REPORT.md) | 122 / 122 tests passed in 17 files, 0 failed |
| [System Validation Report](SYSTEM_VALIDATION_REPORT.md) | All 18 functional and 5 security requirements pass end to end; NFR checks needing a deployed environment are listed |
| [Code Coverage Report](CODE_COVERAGE_REPORT.md) | 94.68 % statements, 93.53 % functions, 94.68 % lines |
| [Branch Coverage Report](BRANCH_COVERAGE_REPORT.md) | 82.18 % branches (932 / 1134), up from 75.52 % |
| [Test Summary Report](TEST_SUMMARY_REPORT.md) | STP §8 summary: results, metrics, exit criteria |
| [Defect Log](DEFECT_LOG.md) | 7 defects found (1 High, 4 Medium, 2 Low), all fixed and re-tested |

Related: [Test Plan v1.1](../STP_v1.1.md) · [Test Case Document](../TEST_CASES.md) · [Requirements Traceability Matrix](../TRACEABILITY.md) · [Deviations](../DEVIATIONS.md) · raw output in [evidence/](evidence/)

Reproduce with `npm ci && npm run test:coverage` (fails if coverage drops below 93 % statements / 80 % branches). CI runs the same command in the "Coverage report (c8)" job and attaches the HTML report.

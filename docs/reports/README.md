# Test Reports (Deliverables Part-3)

Testing according to the STP, executed on 17-11-2026 by Sakaray Vishal (QA Lead).

| Report | Headline |
| --- | --- |
| [Unit Test Report](UNIT_TEST_REPORT.md) | 86 / 86 tests passed, 0 failed |
| [System Validation Report](SYSTEM_VALIDATION_REPORT.md) | All 18 functional and 5 security requirements pass end to end; 3 NFR checks open for UAT |
| [Code Coverage Report](CODE_COVERAGE_REPORT.md) | 94.15 % statements, 93.01 % functions, 94.15 % lines |
| [Branch Coverage Report](BRANCH_COVERAGE_REPORT.md) | 80.07 % branches (848 / 1059), up from 75.52 % |

Related: [Test Case Document](../TEST_CASES.md) · [Requirements Traceability Matrix](../TRACEABILITY.md) · raw output in [evidence/](evidence/)

Reproduce with `npm ci && npm run test:coverage`.

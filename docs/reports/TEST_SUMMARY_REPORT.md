# Test Summary Report

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) v1.0 |
| Report | Test Summary Report (STP §8 deliverable; IEEE 829 structure) |
| Prepared by | Sakaray Vishal (QA Lead), PES1UG24AM241 |
| Test cycle | Part-3 testing, executed 17-11-2026 (planned 02-11 to 06-11-2026) |
| Build | Branch `vishal-qa-hardening` = `main` at `b4c18dd` + PR #9 + PR #10 |
| Recommendation | **Ready for demo / UAT.** Exit criteria met; three non-functional checks need a deployed environment. |

## 1. Summary

All planned automated tests were executed and passed: **114 of 114**, in 16 test files. Testing found **3 defects** in the claims area: one High (the server could crash), one Medium and one Low. All three were reproduced with a failing test, fixed, and re-tested in the same cycle. Coverage is **94.3 % of statements and 80.98 % of branches**, and CI now fails any change that lowers it below 93 % / 80 %.

## 2. Test items

All modules listed in STP §2, at the build above: quote generation, underwriting/KYC, policy issuance and renewal, claims processing, workflow engine, notification service, admin/RBAC. Plus the modules added during the sprints: payments and invoices, cancellation, reports and dashboards, audit log, security hardening.

## 3. Variances from the plan

| Variance | Detail |
| --- | --- |
| Schedule | Executed 17-11-2026 instead of 02–06-11-2026 |
| Tools and environment | `node:test`, in-memory SQLite, in-process event bus instead of JUnit/Jest, PostgreSQL, Kafka, Camunda (STP §5, §6) |
| Scope | Grew from the 9 features in STP §3 to all 18 functional, 5 non-functional and 5 security requirements |
| Defect tracking | GitHub PRs and the defect log instead of Jira |

Full list: [DEVIATIONS.md](../DEVIATIONS.md) §6. Updated plan: [STP v1.1](../STP_v1.1.md).

## 4. Comprehensiveness

| Requirement group | Requirements | With passing automated tests | Manual / deployed-environment only |
| --- | --- | --- | --- |
| Functional (IWA-F) | 18 | 18 | 0 |
| Non-functional (IWA-NF) | 5 | 3 (NF-001 in-process, NF-003, NF-004 immutability) | NF-002 uptime, NF-005 accessibility, NF-001 k6 run |
| Security (IWA-SR) | 5 | 5 | 0 |
| STP §5.1 security validation | 6 items | 4 fully (PII masking, TLS 1.2+, fuzzing of claim/quote inputs, RBAC bypass attempts); penetration testing partly (lockout, OTP replay, token revocation, forged JWTs and workflow role checks are automated) | OWASP ZAP scan; PCI-DSS & GDPR compliance checklist (supported by design: no card data is handled, only sandbox payment tokens, and PII is encrypted and masked, but no formal checklist review yet) |

Requirement coverage (functional + security): **23 / 23 = 100 %**. Traceability: [TRACEABILITY.md](../TRACEABILITY.md).

## 5. Summary of results (STP §14 metrics)

| Metric | Value |
| --- | --- |
| Test cases planned (automated) | 114 |
| Executed | 114 (100 %) |
| Passed | 114 (100 %) |
| Failed / blocked / skipped | 0 / 0 / 0 |
| Automation coverage | 114 automated cases + 6 manual or environment checks; automated share 95 % |
| Statement / branch / function coverage | 94.3 % / 80.98 % / 93.53 % |
| QA Lead's modules (claims, fraud, settlement, notifications) | 100 % statements; branches 96.1 % / 100 % / 100 % / 100 % |
| Defects found | 3 (High 1, Medium 1, Low 1) |
| Defects fixed and verified | 3 |
| Defects open | 0 |
| Defect aging | 0 days (all fixed on the day found) |

## 6. Defects

| ID | Severity | Summary | Status |
| --- | --- | --- | --- |
| DEF-01 | High | A notification error (unreadable encrypted contact details) became an unhandled promise rejection that would terminate the server | Fixed, verified |
| DEF-02 | Medium | Impossible dates (2026-02-30) accepted as claim incident date and date of birth | Fixed, verified |
| DEF-03 | Low | Claim and approved amounts accepted `true`, `[5]`, `"0x10"` via `Number()` coercion | Fixed, verified |

Steps to reproduce, root causes and fix commits: [DEFECT_LOG.md](DEFECT_LOG.md).

## 7. Evaluation

- **Claims processing (F-020 to F-024)** is the most thoroughly tested area: unit tests for every fraud rule and settlement case, API edge cases, a 30-check RBAC matrix, injection and path-traversal fuzzing, a contract check against the SAD, and end-to-end tracking of a claim from filing to the signed settlement letter.
- **Reliability** improved: claim processing can no longer be stopped by a notification failure (DEF-01).
- **Residual risk:** load behaviour on real infrastructure (NF-001 k6), availability (NF-002), accessibility (NF-005), a ZAP scan and a formal PCI-DSS/GDPR checklist review are not yet done. Branch coverage is lowest in `users.js` (57 %) and `customers.js` (68 %), which are outside the QA Lead's modules.

## 8. Exit criteria (STP §5)

| Criterion | Result |
| --- | --- |
| 100 % of planned test cases executed | Met: 114 / 114 |
| 0 critical defects open | Met: 0 open of any severity |
| All acceptance criteria met | Met for all high-priority F and SR requirements; NF-002/NF-005 need a deployed environment |

## 9. Activities

| Activity | Date | By |
| --- | --- | --- |
| Baseline run on latest `main` (51 tests, coverage) | 17-11-2026 | Vishal |
| New tests for claims, fraud, settlement, notifications (PR #9) | 17-11-2026 | Vishal |
| Contract, security, resilience, tracking tests; DEF-01..03 found and fixed; CI coverage job and gate (PR #10) | 17-11-2026 | Vishal |
| Smoke test of the running server | 17-11-2026 | Vishal |
| Reports, RTM, test case document, defect log, deviations | 17-11-2026 | Vishal |
| Code review and approval | pending | Samarth (Developer Lead) |

## 10. Approvals

| Role | Name | Signature / Date |
| --- | --- | --- |
| QA Lead | Sakaray Vishal | |
| Developer Lead | Samarth A | |
| Project Lead | Sanjith Suresh Kumar | |

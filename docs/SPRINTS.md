# Sprint Plan and Delivery Record

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Covers | Course Deliverables Part-2 (backlog, story points, Sprint 1, Sprint 2) and the Part-3 spill-over |
| Recorded | 17-11-2026, after the sprints. The plan below was written down from `docs/WORK_SPLIT.md` and the SRS; delivery dates and PRs come from the git history. |
| Board | GitHub Project "IWAS Backlog" linked to this repository |

> **Honest note.** The team did not keep a GitHub Project board or story points during the sprint weeks. This document and the board record the plan and estimates afterwards, and compare them with what was actually delivered and when. Nothing here is backdated.

## 1. Team and roles

| Member | Role | Owns (WORK_SPLIT) |
| --- | --- | --- |
| Sanjith Suresh Kumar | Project Lead | Quotes, underwriting, KYC, workflow engine, integration; repository owner |
| Samarth A | Developer Lead | Policies, payments, documents/PDF, web UI; code review |
| Sakaray Vishal | QA Lead | Claims, fraud, settlement, notifications; test plan, RTM, test reports |
| Sampreeth Jaladi | DevOps / Security | Auth, MFA, RBAC, audit, encryption, dashboards/reports, CI/CD, Docker |

## 2. Estimation

Story points use the Fibonacci scale (1, 2, 3, 5, 8). They estimate relative effort and uncertainty, not hours: 1 = a small, well-understood change; 8 = a large piece with unknowns (e.g. a BPMN engine). Owners follow WORK_SPLIT.

## 3. Sprint backlog: plan vs actual

### Sprint 1: 19–23 Oct 2026 (goal: buy a policy end to end, file a claim)

| Item | Requirement | Owner | SP | Delivered in | Date |
| --- | --- | --- | --- | --- | --- |
| Personalised quote | IWA-F-001 | Sanjith | 3 | PR #5 | 01-11-2026 |
| Risk scoring + manual review | IWA-F-002 | Sanjith | 5 | PR #5 | 01-11-2026 |
| KYC before issuance | IWA-F-003 | Sanjith | 3 | PR #5 | 01-11-2026 |
| Signed policy PDF after payment | IWA-F-010 | Samarth | 5 | PR #5 | 01-11-2026 |
| Invoice with tax breakup | IWA-F-013 | Samarth | 2 | PR #5 | 01-11-2026 |
| Claim registration with documents | IWA-F-020 | Vishal | 5 | PR #5 | 01-11-2026 |
| RBAC for all modules | IWA-F-031 | Sampreeth | 3 | PR #5 | 01-11-2026 |
| TLS 1.2+ | IWA-SR-001 | Sampreeth | 1 | PR #5 | 01-11-2026 |
| MFA for admin/underwriter | IWA-SR-002 | Sampreeth | 3 | PR #5 | 01-11-2026 |
| AES-256 at rest, TLS in transit | IWA-NF-003 | Sampreeth | 3 | PR #5 | 01-11-2026 |
| CI pipeline (GitHub Actions) | Part-2 1.b | Sanjith | 2 | PR #2 (and direct commit) | 10-10-2026 |
| **Total** | | | **35** | | |

### Sprint 2: 26–30 Oct 2026 (goal: claim approval, settlement, admin, freeze)

| Item | Requirement | Owner | SP | Delivered in | Date |
| --- | --- | --- | --- | --- | --- |
| Renewal with 30/15/7-day reminders | IWA-F-011 | Samarth | 3 | PR #5 | 01-11-2026 |
| Endorsement with audit trail | IWA-F-012 | Samarth | 3 | PR #5 | 01-11-2026 |
| Digitally signed documents | IWA-SR-005 | Samarth | 3 | PR #5 | 01-11-2026 |
| Role-based web UI, accessibility | SRS 3.1, IWA-NF-005 | Samarth | 5 | PR #5 | 01-11-2026 |
| Multi-level BPMN approval engine | IWA-F-021 | Sanjith | 8 | PR #5 | 01-11-2026 |
| Admin designs/deploys BPMN | IWA-F-030 | Sanjith | 3 | PR #5 | 01-11-2026 |
| Fraud detection rules | IWA-F-022 | Vishal | 5 | PR #5 | 01-11-2026 |
| Settlement per policy terms | IWA-F-023 | Vishal | 3 | PR #5 | 01-11-2026 |
| Claimant notifications | IWA-F-024 | Vishal | 3 | PR #5 | 01-11-2026 |
| p95 ≤ 2 s performance test | IWA-NF-001 | Vishal | 2 | PR #5 | 01-11-2026 |
| Dashboards with SLA metrics | IWA-F-032 | Sampreeth | 3 | PR #5 | 01-11-2026 |
| CSV/PDF report export | IWA-F-033 | Sampreeth | 2 | PR #5 | 01-11-2026 |
| Immutable audit log | IWA-F-034, IWA-NF-004 | Sampreeth | 3 | PR #5 | 01-11-2026 |
| PII masking | IWA-SR-003 | Sampreeth | 2 | PR #5 | 01-11-2026 |
| Rate limiting | IWA-SR-004 | Sampreeth | 2 | PR #5 | 01-11-2026 |
| **Total** | | | **50** | | |

### Sprint 3 (spill-over, Part-3 window): 1–17 Nov 2026

| Item | Requirement | Owner | SP | Delivered in | Date |
| --- | --- | --- | --- | --- | --- |
| Login hardening: lockout, OTP replay, logout revocation, CI security scans | IWA-SR-002, SR-004 | Sampreeth | 5 | PR #6 | 01-11-2026 |
| Availability: health checks, Docker image | IWA-NF-002 | Sampreeth | 2 | PR #5, #6 | 01-11-2026 |
| Renewals-due report and pipeline metrics | IWA-F-032, F-033 | Sanjith | 2 | PR #7 | 08-11-2026 |
| Policy cancellation with pro-rata refund (new) | IWA-F-014 | Sanjith | 3 | PR #8 | 11-11-2026 |
| Test execution, coverage, Part-3 reports | STP | Vishal | 8 | PR #9, #10 | 17-11-2026 |
| Defect fixes DEF-01..07 | STP §8 | Vishal | 5 | PR #10, #11 | 17-11-2026 |
| **Total** | | | **25** | | |

## 4. Velocity and load

| Member | Sprint 1 SP | Sprint 2 SP | Sprint 3 SP | Total |
| --- | --- | --- | --- | --- |
| Sanjith | 13 | 11 | 5 | 29 |
| Samarth | 7 | 14 | 0 | 21 |
| Vishal | 5 | 13 | 13 | 31 |
| Sampreeth | 10 | 12 | 7 | 29 |
| **Team** | **35** | **50** | **25** | **110** |

Planned velocity was 35 (Sprint 1) and 50 (Sprint 2). **Actual velocity committed to the repository inside the sprint windows was 0**, apart from the CI pipeline (2 SP, done early on 10 Oct): the Sprint 1 and Sprint 2 items were not committed during the sprints and were integrated together on 01-11-2026 in PR #5.

## 5. What went wrong (blockers)

| Blocker | Effect |
| --- | --- |
| No board or story points were set up at the start (Part-2 §1) | Nobody could see progress or slippage during the sprints |
| Work was not committed to the shared repository during the sprints | Sprint 1 and Sprint 2 have no commits; everything arrived in one large PR (#5, 5,983 lines) |
| No PR reviews before merging (#5–#9 merged without an approval) | The course rule "one teammate's approval" was not followed; defects reached `main` (DEF-01..07, found later in testing) |
| Sprint demo videos not recorded at the end of each sprint | The Part-2 video deliverables were missing at the sprint deadlines |

## 6. What went right

- All 18 functional, 5 non-functional and 5 security requirements were implemented and are traced to tests ([TRACEABILITY.md](TRACEABILITY.md)).
- After 1 Nov the team worked in small feature branches with CI on every PR (#6–#11).
- Testing in Sprint 3 found 7 defects, each reproduced with a test and fixed, and raised branch coverage from 75.5 % to over 80 %.

## 7. Retrospective: what we would do differently

1. Create the board on day one and update it in every stand-up.
2. Commit small and often to feature branches inside each sprint, not at the end.
3. Require one approving review on `main` (branch protection) before any merge.
4. Record the sprint demo video on the last day of each sprint.
5. Write tests together with the feature, so defects are caught in the same sprint.

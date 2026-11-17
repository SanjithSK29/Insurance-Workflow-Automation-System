# SRS and SAD: changes since v1.0 (as built)

| | |
| --- | --- |
| Applies to | `SRS - Insurance Workflow Automation System.pdf` (v1.0, 18-08-2025) and `SAD - Insurance Workflow Automation System.pdf` (v1.0, 09-09-2025) in the repository root |
| Recorded | 17-11-2026, by checking the code on `main` against each section |
| Purpose | The course FAQ asks for the SRS and SAD as finally implemented, with deviations documented. The v1.0 PDFs are kept unchanged as submitted; this page lists what differs. |

Related: [README "Differences from the documented stack"](../README.md#differences-from-the-documented-stack), [DEVIATIONS.md](DEVIATIONS.md) (claims and testing detail), [TRACEABILITY.md](TRACEABILITY.md) (requirement → code → test).

## 1. SRS v1.0 → as built

| SRS section | v1.0 says | As built | Impact |
| --- | --- | --- | --- |
| §4.2 requirements | F-010 to F-013 | **Added IWA-F-014: policy cancellation with pro-rata refund** (PR #8) | New requirement, traced and tested (TC-Cancel-01/02) |
| §4.3 F-024 statuses | registered, under review, approved, settled | Same, plus **REJECTED** | Claimant is told when a claim is turned down |
| §8 RTM | 7 rows, all status N | Full RTM in `docs/TRACEABILITY.md`: 18 F, 5 NF, 5 SR, all with tests and status | RTM moved to its own document and completed |
| §2.4 operating environment | AWS/Azure, Kubernetes, PostgreSQL, Redis, Kafka | Node.js (≥ 22.13) and SQLite in one process; Docker image; no Redis, no Kafka | Runs on a laptop and in CI with one `npm install` |
| §3.1 user interface | React, English + regional languages | Plain-JavaScript single-page UI (`public/app.js`) with English and **Hindi** labels, role-based screens | Same screens and accessibility features, no React |
| §3.3 software interfaces | KYC API, payment gateway (Razorpay/Stripe), SendGrid, Twilio, S3, legacy policy-admin SOAP/REST bridge | KYC, payment, email and SMS are **sandbox adapters** with outage/decline/timeout modes; documents stored in the database; **no legacy policy-admin bridge** | Real vendors plug in at the adapter objects; the legacy bridge is not implemented |
| §3.4 communications | TLS 1.2+, mutual TLS between services, JWT, OAuth 2.0 for third parties, retry with backoff | TLS 1.2+ (when certificates are configured), JWT, retry with backoff and circuit breakers; **no mutual TLS** (single process) and **no OAuth 2.0** (no real third parties) | Covered by IWA-SR-001 tests; mTLS/OAuth would come with real services |
| §5 NF-002 / NF-005 | 99.9 % uptime, WCAG 2.1 AA audit | Health checks and Docker `HEALTHCHECK`; accessibility features built in | Uptime and a formal accessibility audit need a deployed environment (open items) |

## 2. SAD v1.0 → as built

| SAD section | v1.0 says | As built | Reason |
| --- | --- | --- | --- |
| §3.5 architecture pattern | **Microservices** + event-driven + BPMN orchestration; monolith rejected | **Modular monolith**: one Express app, one module per SAD service (`src/modules/*`, `src/workflow/*`) with the same boundaries; modules talk through `ctx.services` and an in-process **event bus** with the SAD's topic names; BPMN orchestration kept | A 4-person student project could not run and test a Kafka + Kubernetes microservice estate; the module boundaries keep the path to split services later |
| §3.4 / §3.6 components | Spring Boot services, Drools, Camunda/Flowable, Kafka, PostgreSQL 15, Redis 7, S3, React | Node.js/Express modules; JavaScript rule engine for underwriting (Drools stand-in); in-house BPMN 2.0 engine reading Camunda's `candidateGroups`; in-process event bus; SQLite; documents in the database; plain-JS UI | See README table for each upgrade path |
| §3.6 infrastructure | Docker, Kubernetes (EKS), Terraform, GitHub Actions | Docker and GitHub Actions (tests, coverage, CodeQL, gitleaks, `npm audit`, image build and health check); **no Kubernetes manifests or Terraform** | No cloud deployment in scope |
| §3.6 monitoring, §4.4 logging | Prometheus, Grafana, ELK; alerts | Structured JSON logs with trace ids and PII redaction, `/api/v1/health`, dashboard SLA metrics; **no Prometheus/Grafana/ELK** | Needs a deployed environment |
| §3.9 security (STRIDE) | MFA, JWT, mTLS, signed documents, append-only audit, AES-256, TLS, PII masking, rate limiting, WAF, autoscaling, RBAC, Vault | All implemented **except** mTLS, WAF, autoscaling and Vault (secrets come from environment variables, `.env.example`) | Infrastructure-level controls, out of scope without a cloud deployment |
| §4.3.2 claim API | `POST /api/v1/claim`, `docs: [names]`, status REGISTERED | Same path (plus `/claims`), `documents` with file content, status UNDER_REVIEW | Details in DEVIATIONS.md §1 |
| §4.2.2 claim sequence | Adjuster review → settlement | Adds fraud investigation (when flagged) and senior approval above 1,00,000 | SRS F-021 "multi-level" approval; DEVIATIONS.md §2 |
| §4.6 open issues | ML fraud detection, blockchain audit, mobile app | Still open; fraud detection is rule-based (7 rules) | Unchanged |

## 3. Unchanged

Functional scope F-001 to F-034, the five non-functional and five security requirements, the user roles (SRS §2.3), the use cases (SRS §7) and the error envelope `{ code, message, traceId }` (SAD §4.4) are implemented as specified.

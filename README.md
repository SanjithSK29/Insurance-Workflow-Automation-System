# Insurance Workflow Automation System (IWAS)

A working implementation of the insurance platform specified in this repository's SRS, SAD and STP. It covers customer onboarding, quotes, underwriting, policies and claims settlement, with BPMN-driven approval workflows, role-based dashboards and an immutable audit trail.

> **Status:** All high-priority functional requirements in the SRS are implemented and covered by automated tests: **40 tests, 40 passing** (`npm test`). See [docs/TRACEABILITY.md](docs/TRACEABILITY.md) for the requirement → code → test mapping and [docs/WORK_SPLIT.md](docs/WORK_SPLIT.md) for team responsibilities.

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`). No database server, Docker or Java is needed for local runs.

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000. Set `PORT` to use a different port. Demo accounts are created on first start (password `Passw0rd!`):

| Role | Email | MFA |
| --- | --- | --- |
| Customer | customer@iwas.test | – |
| Agent / broker | agent@iwas.test | – |
| Underwriter | underwriter@iwas.test | secret `KRSXG5CTMVRXEZLU` |
| Claims adjuster | adjuster@iwas.test | – |
| Admin / ops | admin@iwas.test | secret `JBSWY3DPEHPK3PXP` |

Admin and underwriter logins need a 6-digit code (IWA-SR-002). Add the secret to any authenticator app, or print the current code with:

```bash
npm run otp -- JBSWY3DPEHPK3PXP
```

The demo data includes an active health policy with a claim waiting for the adjuster, and a high-risk life application waiting for the underwriter. Payments use sandbox tokens (`tok_success`, `tok_decline`, `tok_flaky`), so no card data is ever handled.

Run the tests:

```bash
npm test
```

Run in Docker:

```bash
docker build -t iwas . && docker run -p 3000:3000 -v iwas-data:/data iwas
```

## What it does

| Area | Features | SRS |
| --- | --- | --- |
| Quotes | Personalised premium from age, income, coverage (health / life / motor / home), term, sum insured and tobacco use, with a full breakdown (loadings, multi-year discount, 18% GST) | F-001 |
| Underwriting | Rule engine scoring 0–100 (age, tobacco, conditions, hazardous occupation, cover-to-income, prior claims); scores at or above a configurable threshold go to manual review | F-002 |
| KYC | Aadhaar/PAN verification before issuance, with a circuit breaker and retries; when the provider is down, cases go to a manual KYC queue for underwriters | F-003 |
| Policies | Issued only after approval, verified KYC and captured payment. Ed25519-signed PDF schedule, renewals with 30/15/7-day reminders, endorsements with pro-rata premium adjustment and audit trail, GST invoices with CGST/SGST breakup | F-010 – F-013 |
| Claims | Registration with PDF/JPG/PNG upload (10 MB limit, content sniffing), rule-based fraud detection (duplicates, early claims, frequency, cover ratio, late reporting), settlement formula (deductible, co-pay, remaining cover), signed settlement letter, notifications at every status | F-020 – F-024 |
| Workflow | BPMN 2.0 engine (start/end events, user tasks with candidate groups, service tasks, exclusive gateways with conditions). The default claim flow is: fraud investigation if flagged → adjuster review → senior approval above ₹1,00,000. Admins edit, validate and deploy new versions from the UI | F-021, F-030 |
| Admin | RBAC on every endpoint, user management, dashboards (SLA breaches, backlog, policy counts, premium collected), CSV/PDF reports, hash-chained append-only audit log with a verify button | F-031 – F-034 |
| Security | AES-256-GCM encryption of PII at rest, PII masking in API/UI/logs except for authorised roles, TOTP MFA, rate limiting, TLS 1.2+ (when a certificate is configured), HSTS/CSP headers, signed documents | NF-003, SR-001 – SR-005 |
| UX | Role-based single-page UI, guided claim filing with a progress tracker, keyboard and screen-reader friendly (labels, skip link, live regions, focus styles), dark mode, English/Hindi navigation | 3.1, NF-005 |

## Architecture

```text
Browser (public/: role-based SPA)
        │  HTTPS + JWT
        ▼
API gateway layer (src/app.js, src/security/middleware.js)
  routing · auth · RBAC · rate limiting · trace ids · secure headers
        │
        ▼
Service modules (src/modules/*, src/workflow/*), one bounded context each
  quotes · underwriting · customers/KYC · policies · payments · documents
  claims (+ fraud, settlement) · notifications · workflow engine · admin
        │                         │
        ▼                         ▼
  Event bus (src/core/events.js)   SQLite (src/core/db.js)
  Kafka stand-in                   schema per bounded context, PostgreSQL-compatible design
```

Each module exposes a service API plus an Express router. Modules call each other through `ctx.services` and react to events (`workflow.task.created`, `workflow.completed`, `customer.kyc_updated`, `policy.issued`, `claim.status_changed`). This keeps the boundaries the SAD describes, so each module can later be split into its own service.

### Differences from the documented stack

The SAD proposes Java/Spring Boot microservices, Kafka, Camunda, PostgreSQL, Redis and S3. To keep the project runnable on a student laptop and in CI with a single `npm install`, this implementation uses:

| SAD | This implementation | Upgrade path |
| --- | --- | --- |
| Spring Boot services | Node.js/Express modules with the same bounded contexts | Each `src/modules/*` router maps 1:1 to a service |
| Kafka | In-process event bus with the same topics | Replace `src/core/events.js` with a Kafka client |
| Camunda | Built-in BPMN 2.0 subset engine; reads Camunda's `candidateGroups` attribute | Deploy the same `.bpmn` files to Camunda |
| PostgreSQL / Redis | SQLite via `node:sqlite` | Port the schema in `src/core/db.js` |
| S3 | Documents table (same API: store / fetch / verify) | Swap storage in `src/modules/documents.js` |
| KYC / payment / SMS / email vendors | Sandbox adapters with the same failure modes (outage, decline, timeout) | Replace the adapter objects |

## API overview

All endpoints are under `/api/v1`, return JSON errors as `{ code, message, traceId }`, and (except `auth`, `quote` and `health`) need `Authorization: Bearer <token>`.

| Method & path | Who | Purpose |
| --- | --- | --- |
| `POST /auth/register`, `POST /auth/login` | public | Customer sign-up; login (+`otp` for MFA roles) |
| `POST /quote` | public / any | Generate a quote (SAD 4.3.1) |
| `POST /customers`, `POST /customers/bulk`, `POST /customers/:id/kyc` | customer, agent | Onboarding, bulk onboarding, KYC |
| `POST /customers/:id/kyc/manual` | underwriter | Resolve manual KYC queue |
| `POST /applications`, `POST /applications/:id/decision` | customer/agent; underwriter | Apply; manual underwriting decision |
| `POST /payments` | customer, agent | Pay premium → policy issued |
| `GET /policies/:id`, `POST /policies/:id/renew`, `POST /policies/:id/endorse` | owner | Policy details, renewal, endorsement |
| `POST /claims` (alias `/claim`), `POST /claims/:id/documents` | customer, agent | Register claim (SAD 4.3.2), add documents |
| `POST /claims/:id/decision`, `POST /claims/:id/settle` | adjuster / admin | Workflow decision; settlement payout |
| `GET /workflow/tasks`, `POST /workflow/tasks/:id/complete` | staff | Task inbox |
| `GET/POST /admin/workflows`, `POST /admin/workflows/validate` | admin | BPMN designer: list, deploy, validate |
| `GET /admin/dashboard`, `GET /admin/reports/:type?format=csv\|pdf` | staff / admin | Dashboards, exports |
| `GET /admin/audit`, `GET /admin/audit/verify` | admin | Audit log and chain verification |
| `GET /documents/:id`, `GET /documents/:id/verify` | owner / staff | Download, signature check |

## Configuration

See [.env.example](.env.example). For any environment that keeps data, set `DATA_KEY`, `JWT_SECRET` and `SIGNING_KEY_PEM`. Otherwise random keys are generated on each start and stored encrypted data becomes unreadable after a restart. Set `TLS_CERT` and `TLS_KEY` to serve HTTPS with TLS 1.2 as the minimum version.

## Repository layout

```text
.
├── .github/workflows/ci-cd-pipeline.yaml   PDF checks + npm test + server smoke test + Docker build
├── Dockerfile
├── docs/
│   ├── TRACEABILITY.md                     RTM: requirement → module → test → status
│   └── WORK_SPLIT.md                       Team responsibilities
├── perf/quote-load.js                      k6 load script (TC-Perf-01 against a deployed env)
├── public/                                 Web UI (index.html, app.js, styles.css)
├── scripts/otp.js                          Prints TOTP codes for demo MFA accounts
├── src/
│   ├── app.js / server.js / seed.js
│   ├── core/          config, db schema, errors, event bus, logger, retry/circuit breaker
│   ├── security/      auth (scrypt, JWT, TOTP), RBAC + rate limit, crypto, PII masking, audit
│   ├── modules/       quotes, underwriting, customers, policies, payments, documents, pdf,
│   │                  claims, fraud, settlement, notifications, admin, users
│   └── workflow/      BPMN parser, expression evaluator, engine, claim-approval.bpmn
├── test/                                   node:test suites named after STP test cases
├── SRS / SAD / STP PDFs
└── README.md
```

## Project team

- **Sanjith Suresh Kumar**: Project Lead
- **Sakaray Vishal**: QA Lead
- **Samarth A**: Developer Lead
- **Sampreeth Jaladi**: DevOps / Security Engineer

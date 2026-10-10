# Insurance Workflow Automation System (IWAS)

An academic software engineering project that specifies a cloud-oriented system for automating insurance workflows, from customer onboarding and quote generation through underwriting, policy management, and claims settlement.

> **Repository status:** This repository currently contains the project specifications, architecture and test plan, plus a GitHub Actions workflow that validates the PDFs. 

## Project overview

IWAS is designed to connect customers, agents, underwriters, claims adjusters and operations staff through role-based web interfaces and automated workflows. It is intended to integrate with external KYC, payment and actuarial services, while providing traceable processing and operational reporting.

The project focuses on:

- Generating personalized insurance quotes and assessing application risk.
- Verifying customer identity before policy issuance.
- Issuing, renewing and endorsing policies, including digital policy documents.
- Registering claims, collecting supporting documents and routing approvals.
- Applying rule-based fraud checks and calculating settlements.
- Orchestrating configurable BPMN workflows and notifying users of status changes.
- Providing role-based access, audit trails and operational dashboards.

## Proposed architecture

The architecture documents describe a microservices-based design with event-driven communication and BPMN workflow orchestration. A web client communicates through an API gateway with services for quotes, underwriting, policies, claims, payments, documents and notifications. PostgreSQL is the primary transactional store; Redis, Kafka and S3-compatible object storage support caching, messaging and documents.

### Documented technology stack

| Area | Proposed technologies |
| --- | --- |
| Web client | React 18, TypeScript, Redux Toolkit |
| Services | Java 17, Spring Boot 3; Node.js for notifications |
| Workflow orchestration | Camunda, BPMN 2.0 |
| Data and messaging | PostgreSQL 15, Redis 7, Apache Kafka |
| Document storage | S3-compatible object storage |
| Infrastructure | Docker, Kubernetes (EKS), Terraform |
| Monitoring | Prometheus, Grafana, ELK Stack |

The architecture also calls out integrations with KYC providers, payment gateways, actuarial services, email/SMS providers and existing policy administration systems. These are design dependencies; the integrations are not provided as runnable services in this repository.

## Project documents

- [Software Requirements Specification (SRS)](./SRS%20-%20Insurance%20Workflow%20Automation%20System.pdf) — product scope, actors, functional and non-functional requirements, interfaces and acceptance criteria.
- [Software Architecture Document (SAD)](./SAD%20-%20Insurance%20Workflow%20Automation%20System.pdf) — proposed architecture, components, technology choices, security considerations and risks.
- [Software Test Plan (STP)](./STP%20-%20Insurance%20Workflow%20Automation%20System.pdf) — planned test scope, strategy, environments, responsibilities and traceability.

## Quality and testing goals

The SRS and STP define targets and planned validation, including:

- API response time of 2 seconds or less at the 95th percentile.
- 99.9% availability.
- Functional validation of quotes, underwriting, policies, claims and workflow approvals.
- Unit, integration, system and user-acceptance testing.
- Performance, accessibility and security testing, including RBAC and TLS validation.

These are documented acceptance goals, not measured results from a deployed system. The test plan proposes tools such as JUnit, Jest, Selenium/Playwright, Postman/RestAssured and JMeter/k6.

## Repository layout

```text
.
├── .github/
│   └── workflows/
│       └── ci-cd-pipeline.yaml
├── SAD - Insurance Workflow Automation System.pdf
├── SRS - Insurance Workflow Automation System.pdf
├── STP - Insurance Workflow Automation System.pdf
└── README.md
```

## Getting started

There is currently no application to install or run in this repository. To explore the project, start with the SRS for requirements, then read the SAD for the design and the STP for the planned verification approach.

## Continuous integration

The GitHub Actions workflow in `.github/workflows/ci-cd-pipeline.yaml` checks that PDF files are present and that each PDF has a valid header and minimum file size. It also reports the changed files. This workflow validates the project documents; it does not build or test an application.

## Project team

As listed in the project documents:

- **Sanjith Suresh Kumar** — Project Lead
- **Sakaray Vishal** — QA Lead
- **Samarth A** — Developer Lead
- **Sampreeth Jaladi** — DevOps / Security Engineer

# Changelog

All notable changes to the Insurance Workflow Automation System (IWAS) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- Redesigned web UI: tokenised design system, inline icon navigation, a light/dark theme toggle and a new split login screen.

## [1.0.0] - 2026-11-19

### Added
- Customer onboarding, quotes, underwriting, KYC, policies, claims and BPMN-driven workflows.
- Role-based single-page UI, TOTP MFA, PII encryption, signed documents and an immutable audit trail.
- Automated test suite (171 tests) and CI/CD with PDF validation, security scans and coverage gates.

### Security
- AES-256-GCM encryption of PII at rest, TLS 1.2+ in transit, WCAG 2.1 AA colour tokens.

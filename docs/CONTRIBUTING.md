# Contributing

Thanks for contributing to IWAS. This guide covers how to propose, build and test changes.

## Getting started

1. Fork or branch from `main` (one feature branch per change).
2. `npm install` (Node.js 22.13+).
3. Make your change and add tests under `test/`.

## Conventions

- Modules live under `src/modules/` and `src/core/`, one bounded context each; each exposes a service API plus an Express router.
- Keep the requirement → code → test mapping up to date in `docs/TRACEABILITY.md`.
- Follow the existing `node:test` style and the `TC-*` test-case naming.

## Before you push

- `npm test` must pass.
- `npm run test:coverage` should stay above the CI thresholds (see `docs/TRACEABILITY.md`).

## Pull requests

Every PR targets `main` and needs one review (see `docs/WORK_SPLIT.md`). The required CI checks (PDF validation, build & test, security scans) must pass before merge.

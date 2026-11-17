# Code Review Log

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Reviewer | Samarth A (Developer Lead), STP §9 "code review" and docs/WORK_SPLIT.md |
| Period | Pull requests #6–#13, merged or opened 01-11 to 17-11-2026 |
| Date of review | 17-11-2026 |
| Method | Read every source change against the SRS/SAD requirement it claims, ran the full suite on the merged result (154 / 154 passing, coverage gate met), and checked how each change interacts with the Developer Lead's modules (policies, payments, documents, web UI) |

Verdicts: **Approved** = no change needed; **Approved with notes** = notes are follow-ups, not blockers; **Changes made** = the review found a problem that was fixed in the Developer Lead's branch.

## Summary

| PR | Author | Title | Verdict | Follow-up |
| --- | --- | --- | --- | --- |
| #6 | Sampreeth | Login hardening: lockout, TOTP replay protection, logout revocation, CI security scans | Approved with notes, **changes made in the UI** | The web UI never called the new `/auth/logout`: DEF-14, fixed |
| #7 | Sanjith | Renewals-due report and dashboard renewal metrics | Approved with notes | Report and metrics were not reachable from the UI; added to Reports and Dashboard |
| #8 | Sanjith | Policy cancellation with pro-rata refund | **Changes made** | Wrong refund after a renewal (DEF-10), fixed; no UI to cancel, added |
| #9 | Vishal | Fraud, settlement, claims edge-case and notification tests | Approved | – |
| #10 | Vishal | QA hardening: DEF-01..03, contract/security tests, coverage gate, STP v1.1 | Approved with notes | See notes |
| #11 | Vishal | Shared `parseNumber()` for DEF-04..07 | Approved; one test adjusted | TC-Endorse-02 now pays for its sum-insured raise (DEF-09) |
| #12 | Vishal | Sprint plan and delivery record | Approved | Sprint 3 table updated with the Developer Lead's items after merge |
| #13 | Vishal | Startup warning for persistent DB without fixed keys; Docker context | Approved with notes | Add a unit test for `missingPersistentSecrets()`; consider failing in production |

## Details

### PR #6: login hardening (Sampreeth)

- **Correct:** lockout after 5 failures is checked before the password, so a locked account gives no password oracle; TOTP steps cannot be reused (`last_totp_step`); trace ids are validated before they reach logs; COOP and Permissions-Policy headers added; tokens carry a `jti` and can be revoked.
- **Note (no change):** `registerFailure()` updates `failed_logins` from the row read at the start of the request. That is safe today because the whole login handler is synchronous (`scryptSync`), so requests cannot interleave. If it is ever made async, use `UPDATE users SET failed_logins = failed_logins + 1`.
- **Note (no change):** lockout lets anyone who knows an email address lock that user out for 15 minutes. This is the usual trade-off; the admin "unlock" action covers it.
- **Found:** the web UI's Log out button only cleared the browser's copy of the token, so revocation never happened from the UI. Logged as **DEF-14** (UI owner: Samarth) and fixed in `4a5ea0c`, with TC-UX-05.

### PR #7: renewals-due report (Sanjith)

- **Correct:** report columns, ordering by soonest expiry, admin-only access, PDF and CSV output.
- **Note:** the dashboard's "overdue" count is ACTIVE policies whose end date has passed. These only exist until the reminder job next runs (every 6 hours) and marks them EXPIRED, so the number is usually 0. Suggest renaming it to "awaiting expiry" or counting EXPIRED policies still inside the 30-day renewal grace period.
- **Gap:** neither the report nor the metrics were reachable from the web UI. Added in `c0e01ba`.

### PR #8: policy cancellation (Sanjith)

- **Correct:** only ACTIVE policies; refund based on remaining days with the cover running through `end_date` inclusive; configurable short-rate fee; signed cancellation letter; refund through the payment service; audit and notification. Two concurrent cancellations cannot both refund, because the status changes before the first `await`.
- **Defect:** the refund divides `policies.premium` (the latest premium only) by the full `start_date … end_date` span. After a renewal that span covers two years, so the refund is roughly halved. Logged as **DEF-10**, fixed in `b6c83ec` by refunding what was paid per period (`unusedPremium()`). TC-Cancel-01/02 pass unchanged.
- **Gap:** no way to cancel from the web UI. Added in `c0e01ba`.

### PR #9: tests (Vishal)

Test-only change (no source files). All of its tests pass on the merged result and use the shared `test/helpers.js` fixtures. Approved.

### PR #10: QA hardening (Vishal)

- **Correct:** DEF-01 fix (`readContact()` + `notifyClaimant()`) removes the unhandled rejection without hiding the failure, because the channel is recorded as FAILED and logged. DEF-02 round-trip date check is minimal and keeps leap days. Coverage gate thresholds are just under the measured values, so they do not block unrelated PRs.
- **Note:** `notifyClaimant()` is fire-and-forget by design. Other modules (policies, underwriting) still call `notifyCustomer()` without `await`; after the DEF-01 fix `notifyCustomer()` no longer rejects for unreadable contacts, so this is safe, but a shared helper would make the intent explicit.

### PR #11: shared `parseNumber()` (Vishal)

- **Correct:** one helper for all JSON numbers; callers keep their own range checks (so `-3` is parsed and then rejected where negatives make no sense).
- **Interaction:** TC-Endorse-02 expected a raise of the sum insured to succeed without payment. That is the free-upgrade defect DEF-09 (found in this review), so the test now sends a payment token (`dc96bf0`). Its coercion checks are unchanged.
- The Developer Lead's endorsement code uses `parseNumber()` instead of a separate parser, so there is one rule for numbers.

### PR #12: sprint plan (Vishal)

Documentation only (`docs/SPRINTS.md`, `docs/SRS_SAD_CHANGES.md`); figures match the git history. After merging, the Sprint 3 table was extended with the Developer Lead's items.

### PR #13: startup warning and Docker context (Vishal)

- **Correct:** `missingPersistentSecrets()` is a small pure function; `.dockerignore` keeps `.env` and `coverage` out of the image.
- **Note:** `missingPersistentSecrets()` has no test (it is in `server.js`, which the suite does not start). A three-case unit test (`:memory:`, file with all keys, file with none) would pin it.
- **Note:** the DEF-01 recommendation was to *require* the keys when the database is a file. A warning is friendlier for local demos; for production, failing to start when `NODE_ENV=production` and keys are missing would be safer. Left to Sampreeth (deployment owner).

## Developer Lead's own changes (self-review)

The branch `samarth-dev-hardening` follows the same rule as the QA cycle: a failing test is committed before each fix (see the test/fix commit pairs in [DEFECT_LOG.md](DEFECT_LOG.md), DEF-08..14). Changes to other owners' files are limited to:

| File | Owner | Change | Why |
| --- | --- | --- | --- |
| `test/numeric-input.test.js` | Vishal | TC-Endorse-02 sends `paymentToken` for its raise | Required by the DEF-09 fix |
| `docs/TEST_CASES.md`, `docs/TRACEABILITY.md`, `docs/reports/DEFECT_LOG.md`, `docs/reports/TEST_SUMMARY_REPORT.md` | Vishal | New rows and totals for the Developer Lead's cases and defects | Keep one test case document, RTM and defect log |
| `package.json`, `package-lock.json` | shared | Dev dependencies `jsdom` 25.0.1 and `axe-core` 4.10.2 (pinned) | Automated WCAG checks |

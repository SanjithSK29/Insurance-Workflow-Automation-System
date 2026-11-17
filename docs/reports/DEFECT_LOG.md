# Defect Log

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) |
| Maintained by | Sakaray Vishal (QA Lead), defect triage per STP §9 and docs/WORK_SPLIT.md |
| Test plan reference | STP v1.0 §8 (Defect Reports), §12 (suspension criteria), §14 (defect metrics) |
| Period | Testing cycle 17-11-2026 |
| Tracking | GitHub pull requests and review comments (the course does not use Jira) |

## 1. Severity scale

| Severity | Meaning |
| --- | --- |
| Critical | Data loss, security breach, or the whole system stops. Triggers STP §12 suspension. |
| High | A core use case fails or the server process can crash. |
| Medium | Wrong data is accepted or stored, but there is a workaround or limited impact. |
| Low | Input validation or cosmetic issue with little business impact. |

## 2. Defects

### DEF-01: Server crashes when a customer's contact details cannot be decrypted

| Field | Value |
| --- | --- |
| Severity | **High** |
| Module | `src/modules/notifications.js` (owner: Vishal), called from `src/modules/claims.js` |
| Requirement | IWA-F-024, IWA-NF-002 (availability) |
| Found by | TC-Notify-10, TC-Notify-11 (written to reproduce it) |
| Status | **Fixed and verified** |

**Steps to reproduce**
1. A customer exists whose email or phone was encrypted with a different data key. This happens whenever the server restarts with a persistent database but no `DATA_KEY`: `src/core/config.js` then generates a new random key, and the `Dockerfile` sets `IWAS_DB=/data/iwas.db` without a `DATA_KEY`.
2. That customer files a claim (or any claim status changes).

**Expected:** the claim is registered; the customer is notified in the app; the email is marked as failed.
**Actual:** `crypto.decrypt()` throws *"Unsupported state or unable to authenticate data"* inside `notifyCustomer()`. Claims calls `notifyCustomer()` without `await`, so the rejected promise is unhandled, and Node.js terminates the process on an unhandled rejection. The test caught two unhandled rejections per claim.

**Root cause:** decryption happened outside the try/catch that protects the email/SMS sending, and the caller did not handle the returned promise.

**Fix**
- `notifications.js`: each contact detail is decrypted inside `readContact()`. On failure the channel is recorded as `FAILED` with a `notification_contact_unreadable` warning, and the in-app message is still delivered.
- `claims.js`: all claimant notifications go through `notifyClaimant()`, which catches both synchronous throws and rejected promises and logs `claim_notification_failed` (defence in depth, TC-Notify-12).

**Commits:** test `665b6b8`, fix `a919fc6`, hardening `33cde0c` (branch `vishal-qa-hardening`).

**Recommendation for the module owner (Sampreeth, `Dockerfile` / deployment):** require `DATA_KEY` (and `JWT_SECRET`, `SIGNING_KEY_PEM`) whenever `IWAS_DB` points to a file, so restarts keep the same keys. Not changed here because it is outside the QA Lead's modules.

### DEF-02: Impossible calendar dates are accepted (e.g. 2026-02-30)

| Field | Value |
| --- | --- |
| Severity | **Medium** |
| Module | `src/core/util.js` (`isIsoDate`), used by `claims.js` (incident date) and `customers.js` (date of birth) |
| Requirement | IWA-F-020 (claim validation), IWA-F-003 (KYC data) |
| Found by | Boundary analysis while writing STP §5.1 fuzzing tests; TC-Date-02, TC-Claim-11 |
| Status | **Fixed and verified** |

**Steps to reproduce:** file a claim with `incidentDate: "2026-02-30"` on a policy that covers February 2026.
**Expected:** 422 `INVALID_CLAIM`, "incidentDate must be YYYY-MM-DD".
**Actual:** 201 Created. JavaScript's `Date` silently rolls 30 February over to 2 March, so the "is it a valid date?" check passed. `2026-04-31` and `2025-02-29` (not a leap year) were accepted too.

**Fix:** `isIsoDate()` now also requires that the parsed date formats back to the same string. `2024-02-29` (leap year) is still accepted.

**Commits:** test `7c2a32f`, fix `bc421f9`. `util.js` is a shared core file (owner: Sampreeth); the one-line change is called out in the pull request for review.

### DEF-03: Claim amounts accept values that only look like numbers after coercion

| Field | Value |
| --- | --- |
| Severity | **Low** |
| Module | `src/modules/claims.js` (owner: Vishal) |
| Requirement | IWA-F-020, IWA-F-021 (adjuster decision), STP §5.1 (fuzzing) |
| Found by | TC-Sec-Claim-06, TC-Sec-Claim-07 |
| Status | **Fixed and verified** |

**Steps to reproduce:** file a claim with `"amount": true`, `"amount": [5]` or `"amount": "0x10"`; or approve with `"approvedAmount": true`.
**Expected:** 422 (claim) / 400 (decision).
**Actual:** accepted as 1, 5 and 16 because `Number()` coerces booleans, one-element arrays and hex strings.

**Fix:** new `parseAmount()` accepts only a finite JSON number or a plain decimal string ("1500", "1500.50", which is what the web UI's number input sends). Used for both `amount` and `approvedAmount`.

**Commits:** tests `96194e9`, fix `39a84cf`.

### DEF-04 to DEF-07: the same number coercion in other modules

After DEF-03, the QA Lead reviewed every module for the same `Number()` coercion and confirmed each case against a running instance. All four were fixed with one shared helper, `parseNumber()` in `src/core/util.js` (finite numbers and plain decimal strings only). Commit `6d22d62` added the helper and moved the claims fix onto it.

| ID | Severity | Module (owner) | Requirement | Wrong behaviour seen | Test | Fix commit |
| --- | --- | --- | --- | --- | --- | --- |
| DEF-04 | Low | `quotes.js` (Sanjith) | IWA-F-001 | `age: [30]`, `income: "0x10000"` (read as 65,536), `term: true`, `sumInsured: [100000]` produced quotes | TC-Quote-06/07 | `1fc091a` |
| DEF-05 | Medium | `customers.js` (Sanjith) | IWA-F-003, F-002 | `income: true` stored as 1 and `""` / `null` as 0; income drives underwriting and the maximum sum insured | TC-KYC-03/04 | `8a81a44` |
| DEF-06 | Medium | `policies.js` (Samarth) | IWA-F-012 | Endorsing `sumInsured: "0x10000"` cut the cover from 5,00,000 to 65,536 and issued a premium refund of 11,963.55; `[700000]` accepted | TC-Endorse-02 | `40b2343` |
| DEF-07 | Medium | `admin.js` (Sampreeth) | IWA-F-002 | Risk threshold `value: true` was stored as 1, which would send almost every application to manual review; `""` / `null` stored as 0 | TC-Admin-02 | `98747b8` |

**Expected for all four:** 400 `INVALID_INPUT` with the field's existing message, and no data changed. **Status:** fixed and verified; numbers and numeric strings (what the web UI sends) behave exactly as before, and each owner's existing tests still pass. Branch `vishal-input-validation` (PR #11).

## 3. Observations (not defects)

| ID | Observation | Decision |
| --- | --- | --- |
| OBS-01 | Remaining cover drops by the amount **paid**, not the amount claimed (100,000 cover, 90,000 claim pays 76,500, so 23,500 remains). | Intended: matches "settlement per policy terms" (F-023). Pinned by TC-Settle-04/09. |
| OBS-02 | EXCEEDS_REMAINING_COVER alone scores 30, below the flag threshold of 50. | Intended: one weak signal should not block a claim; combined with another rule it is flagged (TC-Settle-09). |
| OBS-03 | Claims can be filed without documents. | Intended: evidence can be added later; the claim gets NO_SUPPORTING_DOCUMENTS (+15). |
| OBS-04 | The claim API returns status `UNDER_REVIEW` where the SAD example shows `REGISTERED`. | Documented deviation (docs/DEVIATIONS.md); REGISTERED is still the first timeline entry. |
| OBS-05 | For a customer created by an agent (no login of their own), the customer's in-app copy has no user to show it to; the agent's copy is delivered. | Low impact; noted for a future change. |

## 4. Defect metrics (STP §14)

| Metric | Value |
| --- | --- |
| Defects found this cycle | 7 (High 1, Medium 4, Low 2) |
| Defects fixed and verified | 7 |
| Open defects | 0 (0 critical) |
| Defect aging | All fixed on the day they were found (17-11-2026) |
| Defect density | QA Lead's modules: 3 defects in 489 lines ≈ 6.1 per KLOC. All modules touched: 7 defects in 1,295 lines (claims, fraud, settlement, notifications, util, quotes, customers, policies, admin) ≈ 5.4 per KLOC |
| Regression | Full suite re-run after every fix: 122 / 122 passing at the end of the cycle |

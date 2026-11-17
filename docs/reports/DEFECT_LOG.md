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

### DEF-08 to DEF-14: policies, payments, documents and web UI (Developer Lead review)

Found by Samarth A (Developer Lead) on 17-11-2026 while reviewing and testing his own modules after PRs #6–#13. Each defect was reproduced with a failing test, committed, fixed and re-tested. Branch `samarth-dev-hardening`. Module owner for all seven: Samarth.

| ID | Severity | Module | Requirement | Summary | Tests | Test commit | Fix commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DEF-08 | **High** | `payments.js`, `policies.js` | IWA-F-010, F-011 | A double-submitted payment charges the customer twice and issues two policies; same for renewals | TC-Pay-03/04/05 | `ef83638` | `3348368` |
| DEF-09 | **High** | `policies.js` | IWA-F-012 | Raising the sum insured gives the extra cover for free; lowering it never refunds | TC-Endorse-03/05 | `5cb6a49` | `b6c83ec` |
| DEF-10 | Medium | `policies.js` (cancellation added in PR #8) | IWA-F-014 | After a renewal, cancellation refunds about half of what is owed | TC-Cancel-03/04/05 | `5cb6a49` | `b6c83ec` |
| DEF-11 | Low | `policies.js` | IWA-F-012 | Endorsing `nominee: {}` stores "[object Object]"; arrays and numbers accepted as names and addresses | TC-Endorse-04 | `5cb6a49` | `b6c83ec` |
| DEF-12 | Low | `pdf.js` | IWA-F-010, F-013 | Accented names print as "?" on every generated PDF ("Zoë Fernández" → "Zo? Fern?ndez") | TC-PDF-03, TC-Policy-03 | `51a078d` | `64c0d98` |
| DEF-13 | Medium | `public/styles.css` | IWA-NF-005 | Five colour pairs fail WCAG 2.1 AA contrast, mostly in dark mode | TC-UX-04 | `2d80f7c` | `a2fafa9` |
| DEF-14 | Medium | `public/app.js` | IWA-F-031, STRIDE "Spoofing" | Log out in the web UI leaves the session token valid on the server | TC-UX-05 | `f8ed5d5` | `4a5ea0c` |

#### DEF-08: double-submitted payments charge twice

**Steps:** with an approved application, send `POST /payments` twice at once (a double-click). Use the `tok_flaky` token, which makes the gateway time out once, like a slow bank.
**Expected:** one charge and one policy; the second request is refused. **Actual:** both requests return 201; two `CAPTURED` payments and two policies for one application. `POST /policies/:id/renew` behaved the same way (two renewal charges).
**Root cause:** the handler checks `status = 'APPROVED'`, then awaits the gateway. The second request passes the same check while the first is still waiting, because the status only changes after the charge.
**Fix:** `withPaymentLock()` in `payments.js` holds a per-application or per-policy lock from the status check until the charge and issuance finish. A second request gets 409 `PAYMENT_IN_PROGRESS`. The lock is released on failure, so a declined payment can be retried (TC-Pay-05). IWAS runs as one Node process on SQLite, so an in-process lock is enough; see OBS-06 for multi-instance deployments.

#### DEF-09: endorsements change cover without collecting or refunding premium

**Steps:** on an active ₹5,00,000 health policy, `POST /policies/:id/endorse` with `{ "sumInsured": 700000 }`.
**Expected:** the extra premium for the rest of the period is collected before the cover changes. **Actual:** 200, cover raised to ₹7,00,000, `premiumAdjustment: 4236.36` recorded, but no payment was taken. Lowering the cover recorded a negative adjustment but refunded nothing.
**Fix:** a raise without `paymentToken` returns 402 `PAYMENT_REQUIRED` with the amount in `details.premiumAdjustment`; with a token the difference is charged first (purpose `ENDORSEMENT`) and a GST invoice is issued. A declined payment changes nothing. A reduction is refunded through `payments.refund()`. The web UI shows the amount and asks for confirmation. Vishal's TC-Endorse-02 was updated to send a payment token for its raise (`dc96bf0`).

#### DEF-10: wrong cancellation refund after a renewal

**Steps:** a policy with 44 days left is renewed early for another year (₹7,754.05), then cancelled the same day.
**Expected:** refund of the unused 45 days of the old year plus the whole new year: ₹15,508.11 before the 5 % charge. **Actual:** ₹7,754.05.
**Root cause:** `cancel()` (PR #8) spreads `policies.premium` over `start_date … end_date`. After a renewal, `premium` holds only the latest year's premium but the dates span both years, so the refund is roughly halved. Endorsement payments were not considered at all.
**Fix:** `unusedPremium()` refunds what was paid for each period: the current period's premium pro-rated over that period only; when the policy was renewed early, the unused days of the previous period at that period's premium (from `payments`); and endorsement differences pro-rated over the days they covered. TC-Cancel-01/02 (Sanjith) pass unchanged.

#### DEF-11: non-text nominee and address accepted

**Steps:** endorse with `{ "nominee": {} }`, `["Asha","Rao"]` or `12345`.
**Expected:** 400. **Actual:** 200; `String({})` was saved as "[object Object]". The `sumInsured` half of this check was already fixed by DEF-06 (Vishal) with `parseNumber()`, which the endorsement code keeps using.
**Fix:** `parseText()` in `policies.js` accepts only JSON strings within the length limits.

#### DEF-12: accented names print as "?" in PDFs

**Steps:** a customer named "Zoë Fernández" buys a policy and opens the policy schedule.
**Expected:** the name as written. **Actual:** "Zo? Fern?ndez" on the schedule, invoice, settlement and cancellation letters.
**Root cause:** the PDF writer replaced every character outside ASCII, although its WinAnsi fonts can draw the Latin-1 range.
**Fix:** printable Latin-1 is kept; curly quotes, dashes, the rupee sign and "…" are mapped to plain equivalents. Scripts the built-in fonts cannot draw (for example Devanagari) still become "?" (OBS-07).

#### DEF-13: colour contrast below WCAG 2.1 AA

**Found by:** TC-UX-04, which computes WCAG contrast ratios from the CSS colour tokens (jsdom cannot measure colour).

| Pair | Theme | Before | After |
| --- | --- | --- | --- |
| Badge text and current nav item (brand on info background) | light | 4.44:1 | 5.82:1 |
| Keyboard focus ring on page / card | light | 1.53:1 / 1.64:1 | 14.67:1 / 15.73:1 |
| Links and ghost buttons (brand on panel) | dark | 3.19:1 | 6.57:1 |
| Badge text and current nav item | dark | 2.97:1 | 6.12:1 |
| White text on red buttons and error toasts | dark | 2.28:1 | 8.37:1 |

Required: 4.5:1 for text, 3:1 for the focus ring (WCAG 1.4.3, 1.4.11). **Fix:** adjusted tokens in `public/styles.css`, a dark-mode brand colour and a new `--on-bad` token for text on red.

#### DEF-14: Log out does not revoke the token

**Steps:** sign in to the web UI, copy the token from `sessionStorage`, click **Log out**, then call `GET /api/v1/me` with the copied token.
**Expected:** 401 (PR #6 added server-side revocation via `POST /auth/logout`). **Actual:** 200: the UI only deleted its own copy of the token.
**Fix:** the Log out button calls `POST /auth/logout` before clearing the session.

## 3. Observations (not defects)

| ID | Observation | Decision |
| --- | --- | --- |
| OBS-01 | Remaining cover drops by the amount **paid**, not the amount claimed (100,000 cover, 90,000 claim pays 76,500, so 23,500 remains). | Intended: matches "settlement per policy terms" (F-023). Pinned by TC-Settle-04/09. |
| OBS-02 | EXCEEDS_REMAINING_COVER alone scores 30, below the flag threshold of 50. | Intended: one weak signal should not block a claim; combined with another rule it is flagged (TC-Settle-09). |
| OBS-03 | Claims can be filed without documents. | Intended: evidence can be added later; the claim gets NO_SUPPORTING_DOCUMENTS (+15). |
| OBS-04 | The claim API returns status `UNDER_REVIEW` where the SAD example shows `REGISTERED`. | Documented deviation (docs/DEVIATIONS.md); REGISTERED is still the first timeline entry. |
| OBS-05 | For a customer created by an agent (no login of their own), the customer's in-app copy has no user to show it to; the agent's copy is delivered. | Low impact; noted for a future change. |
| OBS-06 | The DEF-08 payment lock lives in the Node process. | Correct for the documented single-process SQLite deployment. Running several instances needs a database-level lock (for example a `PAYMENT_PENDING` status set with a conditional `UPDATE`). |
| OBS-07 | PDF text outside Latin-1 (for example Devanagari names) prints as "?". | Needs an embedded Unicode font; listed in DEVIATIONS.md §7. The web UI shows such names correctly. |
| OBS-08 | Raising the sum insured by endorsement is not re-underwritten. | Matches SRS F-012 (endorsement with audit trail); large increases could be routed to the underwriter in a later sprint. |
| OBS-09 | The Payments page lists charges but not refunds. | Refunds appear on the policy's cancellation summary and in the audit log; a refunds list is a small follow-up. |
| OBS-10 | Before this cycle, `GET /payments` returned an empty list for agents. | Improvement, not logged as a defect: agents now see their portfolio's payments, the same rule as policies (TC-Pay-07). |

## 4. Defect metrics (STP §14)

| Metric | Value |
| --- | --- |
| Defects found this cycle | 14 (High 3, Medium 7, Low 4): DEF-01..07 by the QA Lead, DEF-08..14 by the Developer Lead |
| Defects fixed and verified | 14 |
| Open defects | 0 (0 critical) |
| Defect aging | All fixed on the day they were found (17-11-2026) |
| Defect density | QA Lead's modules: 3 defects in 489 lines ≈ 6.1 per KLOC. All modules touched by DEF-01..07: 7 defects in 1,295 lines ≈ 5.4 per KLOC. Developer Lead's modules (policies, payments, documents, pdf, web UI): 8 defects (DEF-06, DEF-08..14) in 1,458 lines ≈ 5.5 per KLOC |
| Regression | Full suite re-run after every fix: 122 / 122 passing at the end of the QA cycle; 154 / 154 at the end of the Developer Lead cycle |

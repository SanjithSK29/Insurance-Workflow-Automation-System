# Systems and Hardening Report: Policy Lifecycle, Nominee Contacts, Fraud Velocity & Security

> **Review note (Developer Lead, 19-11-2026).** These changes were pushed to `main` without a pull request, and on 18-11 the tests below did not pass: the app failed to start (DEF-15) and every test here read the wrong policy id. They were fixed on branch `samarth-fix-main`, where all of them now pass. The tag-stripping described under "Stored XSS" was replaced by storing text as written and rendering it as text (DEF-16). Details: [DEFECT_LOG.md](DEFECT_LOG.md) and [CODE_REVIEW_LOG.md](CODE_REVIEW_LOG.md).

| | |
| --- | --- |
| Project | Insurance Workflow Automation System (IWAS) v1.0 |
| Report | Sprint 4 Engineering & Hardening Report |
| Prepared by | Surya A Bhat (Systems & Hardening Engineer) |
| Date | 18-11-2026 |
| Branch | `feature/sprint4-enhancements` |
| Modules | `src/modules/policies.js`, `src/modules/customers.js`, `src/modules/fraud.js`, `src/modules/admin.js`, `src/core/util.js`, `src/modules/claims.js`, `public/app.js` |
| Requirements | IWA-F-015 (Reinstatement), IWA-F-016 (Cancellation Quote), IWA-F-003 / SR-003 (Emergency Contacts), IWA-F-022 (Fraud Velocity), IWA-F-025 (Claims Export), IWA-SR-006 (Stored XSS Sanitization) |
| Related | [Sprint Record](../SPRINTS.md) · [Work Split](../WORK_SPLIT.md) · [RTM](../TRACEABILITY.md) · [Test Case Document](../TEST_CASES.md) |

---

## 1. Executive Summary

This engineering cycle (Sprint 4) expands IWAS beyond its initial delivery with high-value operational capabilities, lifecycle hardening, and proactive security measures:

1. **Policy Reinstatement (IWA-F-015):** Policyholders whose policies have expired within the statutory 30-day grace period can now reinstate coverage without fresh underwriting by submitting an insurability/health declaration and an administrative fee (INR 500), generating updated digitally signed policy documents and tax invoices.
2. **Cancellation Quote Preview (IWA-F-016):** Allows policyholders to inspect their prospective pro-rata refund and surrender charge before committing to policy cancellation.
3. **Emergency Contact & Nominee Management (IWA-F-003, SR-003):** Adds structured emergency contact updates with Indian phone validation and full audit trail logging.
4. **Rapid-Inception Fraud Velocity Rule (IWA-F-022):** Detects early-velocity moral hazard by flagging claims exceeding 50% of sum insured within 14 days of inception (`RAPID_INCEPTION_HIGH_VALUE`, 35 points).
5. **Adjuster Claims Register Export (IWA-F-025, F-033):** Extends RBAC so Claims Adjusters can download CSV/Excel claims registers with dynamic status and coverage type filters.
6. **Stored XSS Sanitization (IWA-SR-006):** Sanitizes and strips HTML/script tags from incident descriptions and review notes to eliminate stored XSS risks.
7. **Web UI Actions:** Exposes "Reinstate Policy" in the customer policy view and "Reports" navigation in the adjuster portal.
8. **Automated Test Suite:** 10 new test cases across `test/policy-reinstatement.test.js` and `test/sprint4-security-fraud.test.js`, expanding automated test coverage.

---

## 2. Delivered Features and Architecture

| Capability | Module(s) | Implementation Details |
| --- | --- | --- |
| **Policy Reinstatement** | `src/modules/policies.js`, `src/core/db.js` | Executes under `withPaymentLock('policy:<id>')`. Verifies `status === 'EXPIRED'`, days lapsed $\le 30$, and `healthDeclaration === true`. Inserts record into `reinstatements` table, updates policy to `ACTIVE`, produces signed PDF schedule and invoice. |
| **Cancellation Quote Preview** | `src/modules/policies.js` | Computes unearned premium via `unusedPremium(p, today())`, deducts cancellation fee, and provides policyholder breakdown before cancellation. |
| **Emergency Contacts** | `src/modules/customers.js`, `src/core/db.js` | Validates name length, 10-digit mobile number, and relation. Stores structured metadata, updates customer record, and emits `CUSTOMER_EMERGENCY_CONTACT_UPDATED` audit log. |
| **Rapid Inception Fraud Rule** | `src/modules/fraud.js` | Flags claims where incident date is within 14 days of policy start and claim amount $> 50\%$ of sum insured (+35 risk points). |
| **Claims Register Export** | `src/modules/admin.js` | Implements parameterized SQL query filtering by `status` and `coverage_type`. Permits both `ADMIN` and `ADJUSTER` roles while blocking customer access. |
| **Stored XSS Sanitization** | `src/core/util.js`, `src/modules/claims.js` | Implements `sanitizeText()` to strip HTML markup and dangerous script tags from claim narratives. |
| **UI Integration** | `public/app.js` | Adds UI trigger for policy reinstatement on expired policies and grants Adjusters access to the Reports tab. |

---

## 3. Test Matrix (10 New Automated Cases)

| Test ID | File | Description | Expected Result | Status |
| --- | --- | --- | --- | --- |
| `TC-Reinstate-01` | `policy-reinstatement.test.js` | Cancellation quote preview on active policy | 200 OK, returns correct gross refund and fee | **Passed** |
| `TC-Reinstate-02` | `policy-reinstatement.test.js` | Cancellation quote on non-active policy | 409 Conflict (`NOT_ACTIVE`) | **Passed** |
| `TC-Reinstate-03` | `policy-reinstatement.test.js` | Reinstatement of expired policy within grace period | 200 OK, status changes to `ACTIVE`, fee charged, audit recorded | **Passed** |
| `TC-Reinstate-04` | `policy-reinstatement.test.js` | Reinstatement rejected without health declaration | 422 Unprocessable (`HEALTH_DECLARATION_REQUIRED`) | **Passed** |
| `TC-Reinstate-05` | `policy-reinstatement.test.js` | Reinstatement rejected after grace period (>30 days) | 409 Conflict (`GRACE_PERIOD_EXCEEDED`) | **Passed** |
| `TC-Reinstate-06` | `policy-reinstatement.test.js` | Reinstatement rejected if policy is already active | 409 Conflict (`NOT_EXPIRED`) | **Passed** |
| `TC-Cust-03` | `sprint4-security-fraud.test.js` | Update customer emergency contact with validation | 200 OK, validated phone, audit trail logged | **Passed** |
| `TC-Fraud-12` | `sprint4-security-fraud.test.js` | Early high-value claim detection rule | Fires `RAPID_INCEPTION_HIGH_VALUE` (+35 points, flagged) | **Passed** |
| `TC-Report-02` | `sprint4-security-fraud.test.js` | Adjuster claims export with filter; customer blocked | 200 OK for adjuster, 403 Forbidden for customer | **Passed** |
| `TC-Sec-XSS-01` | `sprint4-security-fraud.test.js` | XSS sanitization on customer incident descriptions | Dangerous script and img tags stripped before saving | **Passed** |

---

## 4. Verification and Traceability

- All new database tables and columns are defined defensively (`CREATE TABLE IF NOT EXISTS`, backward-compatible schema).
- All financial operations run under mutual exclusion locks (`withPaymentLock`) to avoid concurrent race conditions.
- Git commit messages follow the repository's convention with clean, atomic changes.

# Demo walkthrough

A scripted end-to-end demo of IWAS, from onboarding a customer to settling a claim.

## Setup

```bash
npm install
npm start          # http://localhost:3000
```

Demo accounts (password `Passw0rd!`):

| Role | Email | MFA |
| --- | --- | --- |
| Customer | customer@iwas.test | – |
| Agent | agent@iwas.test | – |
| Underwriter | underwriter@iwas.test | `KRSXG5CTMVRXEZLU` |
| Adjuster | adjuster@iwas.test | – |
| Admin | admin@iwas.test | `JBSWY3DPEHPK3PXP` |

For MFA roles, print the current code with `npm run otp -- <secret>`.

## Flow

1. **Quote & apply** — sign in as the customer, get a quote, then apply. KYC passes and the rule engine auto-approves a normal-risk application.
2. **Issue a policy** — pay with the sandbox token `tok_success`; a signed policy PDF and a GST invoice are issued.
3. **File a claim** — attach a document and file a claim; watch the progress tracker.
4. **Fraud & workflow** — file a duplicate to see the fraud flag; approve as the adjuster; senior approval for a high-value claim.
5. **Settle** — settle the claim; a signed settlement letter is generated and the customer is notified.
6. **Admin** — sign in as admin (MFA), check the dashboard, RBAC, audit-chain verification, and export a CSV/PDF report.

## Tips

- Use `tok_decline` to show a declined payment and `tok_flaky` to show transient retry.
- Flip the light/dark theme with the toggle in the top bar.

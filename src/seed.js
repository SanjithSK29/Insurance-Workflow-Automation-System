// Demo data: one user per role plus a customer with an active policy and an
// open claim, so every dashboard has something to show on first start.
// The TOTP secrets are fixed demo values; never reuse them outside local dev.

const DEMO_PASSWORD = 'Passw0rd!';

const DEMO_USERS = [
  { email: 'admin@iwas.test', name: 'Asha Admin', role: 'ADMIN', mfaSecret: 'JBSWY3DPEHPK3PXP' },
  { email: 'underwriter@iwas.test', name: 'Uday Underwriter', role: 'UNDERWRITER', mfaSecret: 'KRSXG5CTMVRXEZLU' },
  { email: 'adjuster@iwas.test', name: 'Arjun Adjuster', role: 'ADJUSTER' },
  { email: 'agent@iwas.test', name: 'Anita Agent', role: 'AGENT' },
  { email: 'customer@iwas.test', name: 'Priya Sharma', role: 'CUSTOMER' },
];

async function seedDemo(ctx) {
  const { db, services: s } = ctx;
  if (db.get('SELECT id FROM users WHERE email = ?', 'admin@iwas.test')) return false;

  const users = {};
  for (const u of DEMO_USERS) users[u.role] = s.users.createUser({ ...u, password: DEMO_PASSWORD });
  const customerUser = { id: users.CUSTOMER.id, role: 'CUSTOMER' };
  const agentUser = { id: users.AGENT.id, role: 'AGENT' };

  const customerId = s.customers.create({
    name: 'Priya Sharma', dob: '1992-04-15', income: 1_200_000,
    email: 'customer@iwas.test', phone: '9876543210', aadhaar: '234567891234', pan: 'ABCPS1234K',
  }, customerUser);

  // Active health policy with a claim waiting for the adjuster.
  const quote = s.quotes.createQuote({ customerId, coverageType: 'health', term: 1, sumInsured: 500_000 }, customerUser);
  const app = await s.underwriting.apply({ quoteId: quote.quoteId, declarations: { smoker: false, conditions: [], occupation: 'Software engineer' } }, customerUser);
  const appRow = db.get('SELECT * FROM applications WHERE id = ?', app.applicationId);
  const payment = await s.payments.charge({ purpose: 'NEW_POLICY', referenceId: appRow.id, total: quote.premium, token: 'tok_success', actorId: customerUser.id });
  const policy = s.policies.issue(appRow, payment.paymentId, customerUser.id);
  s.payments.generateInvoice(payment.paymentId, { customerId, policyNumber: policy.policyNumber, description: 'health insurance premium, 1 year(s)' });
  await s.claims.register({
    policyId: policy.policyId, claimType: 'hospitalization', amount: 42_000, incidentDate: policy.startDate,
    description: 'Two-day admission for viral fever',
    documents: [{ filename: 'discharge-summary.pdf', mime: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4\n% demo discharge summary\n%%EOF').toString('base64') }],
  }, customerUser);

  // A second customer onboarded by the agent, with a high-risk life application in review.
  const agentCustomer = s.customers.create({
    name: 'Rahul Verma', dob: '1968-09-02', income: 900_000,
    email: 'rahul.verma@example.com', phone: '9123456780', aadhaar: '345678912345', pan: 'BCDPV2345L',
  }, agentUser);
  const lifeQuote = s.quotes.createQuote({ customerId: agentCustomer, coverageType: 'life', term: 10, sumInsured: 15_000_000, smoker: true }, agentUser);
  await s.underwriting.apply({ quoteId: lifeQuote.quoteId, declarations: { smoker: true, conditions: ['hypertension'], occupation: 'Construction supervisor' } }, agentUser);

  return true;
}

module.exports = { seedDemo, DEMO_USERS, DEMO_PASSWORD };

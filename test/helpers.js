// Shared test harness: boots an isolated app (in-memory DB) on a random port,
// creates one user per role and exposes a small HTTP client.
const { createApp } = require('../src/app');
const { totp } = require('../src/security/auth');

const PASSWORD = 'Test@12345';
const ROLES = ['ADMIN', 'UNDERWRITER', 'ADJUSTER', 'AGENT', 'CUSTOMER'];

const pdfDoc = (name = 'evidence.pdf') => ({
  filename: name,
  mime: 'application/pdf',
  contentBase64: Buffer.from('%PDF-1.4\n% test evidence\n%%EOF').toString('base64'),
});

async function startApp(overrides = {}) {
  const { app, ctx, close } = createApp({ logLevel: 'silent', seedDemoData: false, ...overrides });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  async function call(method, path, { token, body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: data, headers: res.headers };
  }

  const users = {};
  for (const role of ROLES) {
    users[role] = ctx.services.users.createUser({ email: `${role.toLowerCase()}@test.local`, name: `${role} User`, role, password: PASSWORD });
  }

  async function login(email, mfaSecret) {
    const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD, ...(mfaSecret ? { otp: totp(mfaSecret) } : {}) } });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.token;
  }

  const tokens = {};
  for (const role of ROLES) tokens[role] = await login(users[role].email, users[role].mfaSecret);

  // Register an additional customer with a complete, KYC-ready profile.
  async function newCustomer(tag, profile = {}) {
    const email = `${tag}@test.local`;
    await call('POST', '/auth/register', { body: { email, name: `Customer ${tag}`, password: PASSWORD } });
    const token = await login(email);
    const res = await call('POST', '/customers', {
      token,
      body: { name: `Customer ${tag}`, dob: '1990-01-15', income: 1_000_000, phone: '9876501234', aadhaar: '234512341234', pan: 'ABCPK1234Z', ...profile },
    });
    if (res.status !== 201) throw new Error(`profile failed: ${JSON.stringify(res.body)}`);
    return { token, customerId: res.body.id };
  }

  // Full purchase path: quote -> apply (KYC + underwriting) -> pay -> policy.
  async function buyPolicy(customer, { coverageType = 'health', sumInsured = 500_000, term = 1, declarations = {} } = {}) {
    const quote = await call('POST', '/quote', { token: customer.token, body: { customerId: customer.customerId, coverageType, sumInsured, term } });
    const app = await call('POST', '/applications', { token: customer.token, body: { quoteId: quote.body.quoteId, declarations } });
    if (app.body.status !== 'APPROVED') throw new Error(`application not approved: ${JSON.stringify(app.body)}`);
    const pay = await call('POST', '/payments', { token: customer.token, body: { applicationId: app.body.applicationId, paymentToken: 'tok_success' } });
    if (pay.status !== 201) throw new Error(`payment failed: ${JSON.stringify(pay.body)}`);
    return { quote: quote.body, application: app.body, payment: pay.body, policy: pay.body.policy };
  }

  return {
    ctx, call, users, tokens, login, newCustomer, buyPolicy,
    close: () => new Promise((resolve) => server.close(() => { close(); resolve(); })),
  };
}

module.exports = { startApp, pdfDoc, PASSWORD };

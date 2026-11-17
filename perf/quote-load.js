// k6 load test for IWA-NF-001 / TC-Perf-01 against a deployed environment:
// "Quote generation and claim status APIs shall respond within 2 seconds for
// 95% of requests under normal load."
//
// Usage: k6 run -e BASE_URL=https://staging.example.com perf/quote-load.js
//
// The deployment's rate limits must allow the configured load: every virtual
// user shares the load generator's IP, so set RATE_LIMIT_PUBLIC_MAX (quotes)
// and RATE_LIMIT_MAX (claim status) above the expected requests per minute.
import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Each API is measured separately, as NF-001 names both.
    'http_req_duration{api:quote}': ['p(95)<2000'],
    'http_req_duration{api:claim_status}': ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = `${__ENV.BASE_URL || 'http://localhost:3000'}/api/v1`;
const TYPES = ['health', 'life', 'motor', 'home'];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function post(path, body, token, tags) {
  const headers = token ? { ...JSON_HEADERS, Authorization: `Bearer ${token}` } : JSON_HEADERS;
  return http.post(`${BASE}${path}`, JSON.stringify(body), { headers, tags });
}

function must(res, step) {
  if (res.status >= 300) throw new Error(`setup step '${step}' failed: HTTP ${res.status} ${res.body}`);
  return res.json();
}

// Runs once before the load: a test customer buys a policy and files a claim,
// so that the virtual users have a real claim whose status they can poll.
export function setup() {
  const email = `k6-${Date.now()}@load.test`;
  const password = 'Load@12345';
  must(post('/auth/register', { email, name: 'k6 Load Test', password }), 'register');
  const { token } = must(post('/auth/login', { email, password }), 'login');
  const customer = must(post('/customers', {
    name: 'k6 Load Test', dob: '1990-01-15', income: 1000000, phone: '9876501234', aadhaar: '234512341234', pan: 'ABCPK1234Z',
  }, token), 'customer profile');
  const quote = must(post('/quote', { customerId: customer.id, coverageType: 'health', sumInsured: 500000, term: 1 }, token), 'quote');
  const application = must(post('/applications', { quoteId: quote.quoteId, declarations: {} }, token), 'application');
  const payment = must(post('/payments', { applicationId: application.applicationId, paymentToken: 'tok_success' }, token), 'payment');
  const evidence = encoding.b64encode('%PDF-1.4\n% k6 load test evidence\n%%EOF');
  const claim = must(post('/claims', {
    policyId: payment.policy.policyId,
    claimType: 'accident',
    amount: 5000,
    incidentDate: new Date().toISOString().slice(0, 10),
    documents: [{ filename: 'evidence.pdf', mime: 'application/pdf', contentBase64: evidence }],
  }, token), 'claim');
  return { token, claimId: claim.claimId };
}

export default function (data) {
  const quote = post('/quote', {
    age: 25 + Math.floor(Math.random() * 30),
    income: 400000 + Math.floor(Math.random() * 1600000),
    coverageType: TYPES[Math.floor(Math.random() * TYPES.length)],
    term: 1,
  }, null, { api: 'quote' });
  check(quote, { 'quote created': (r) => r.status === 201, 'has premium': (r) => r.json('premium') > 0 });

  const status = http.get(`${BASE}/claims/${data.claimId}`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { api: 'claim_status' },
  });
  check(status, { 'claim status returned': (r) => r.status === 200 && typeof r.json('status') === 'string' });

  sleep(1);
}

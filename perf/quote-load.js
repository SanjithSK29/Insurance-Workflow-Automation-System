// k6 load test for IWA-NF-001 / TC-Perf-01 against a deployed environment.
// Usage: k6 run -e BASE_URL=https://staging.example.com perf/quote-load.js
// The deployment's RATE_LIMIT_PUBLIC_MAX must allow the configured load.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95th percentile under 2 s
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const TYPES = ['health', 'life', 'motor', 'home'];

export default function () {
  const body = JSON.stringify({
    age: 25 + Math.floor(Math.random() * 30),
    income: 400000 + Math.floor(Math.random() * 1600000),
    coverageType: TYPES[Math.floor(Math.random() * TYPES.length)],
    term: 1,
  });
  const res = http.post(`${BASE}/api/v1/quote`, body, { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'quote created': (r) => r.status === 201, 'has premium': (r) => r.json('premium') > 0 });
  sleep(1);
}

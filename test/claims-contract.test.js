// Contract tests: the claims API against the design in SAD §4.3.2 (Claim API)
// and §4.4 (standard error envelope { code, message, traceId }).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, pdfDoc } = require('./helpers');
const { today } = require('../src/core/util');

describe('Claims API contract (SAD 4.3.2, 4.4)', () => {
  let t;
  let c;
  let policy;
  before(async () => {
    t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } });
    c = await t.newCustomer('ct1');
    ({ policy } = await t.buyPolicy(c));
  });
  after(() => t.close());

  const claimBody = (extra = {}) => ({ policyId: policy.policyId, claimType: 'accident', amount: 50000, incidentDate: today(), documents: [pdfDoc('doc1.pdf')], ...extra });

  // SAD 4.4: every error carries { code, message, traceId }, and the traceId
  // matches the X-Trace-Id response header so support can find the log line.
  const assertEnvelope = (res, status, code) => {
    assert.equal(res.status, status);
    assert.equal(typeof res.body.code, 'string');
    assert.equal(typeof res.body.message, 'string');
    assert.ok(res.body.message.length > 0);
    assert.equal(res.body.traceId, res.headers.get('x-trace-id'));
    if (code) assert.equal(res.body.code, code);
  };

  test('TC-Contract-01: POST /api/v1/claim (singular, as in the SAD) registers a claim', async () => {
    const res = await t.call('POST', '/claim', { token: c.token, body: claimBody() });
    assert.equal(res.status, 201);
    assert.match(res.body.claimId, /^C[0-9A-F]{10}$/);
    assert.equal(res.body.eta, '5 days', 'SAD example response: eta "5 days"');
    // Deviation (docs/DEVIATIONS.md): the SAD shows status REGISTERED, but the
    // workflow assigns the first task synchronously, so the response already
    // says UNDER_REVIEW. REGISTERED is still the first entry in the timeline.
    assert.equal(res.body.status, 'UNDER_REVIEW');
    const detail = await t.call('GET', `/claim/${res.body.claimId}`, { token: c.token });
    assert.equal(detail.body.timeline[0].action, 'CLAIM_REGISTERED');
  });

  test('TC-Contract-02: SAD error codes: 401 Unauthorized, 404 Policy not found, 422 Invalid claim', async () => {
    assertEnvelope(await t.call('POST', '/claim', { body: claimBody() }), 401, 'UNAUTHORIZED');
    assertEnvelope(await t.call('POST', '/claim', { token: 'not-a-jwt', body: claimBody() }), 401, 'UNAUTHORIZED');
    assertEnvelope(await t.call('POST', '/claim', { token: c.token, body: claimBody({ policyId: 'P456' }) }), 404, 'NOT_FOUND');
    assertEnvelope(await t.call('POST', '/claim', { token: c.token, body: claimBody({ amount: -1 }) }), 422, 'INVALID_CLAIM');
  });

  test('TC-Contract-03: every claims error uses the standard envelope', async () => {
    const id = (await t.call('POST', '/claims', { token: c.token, body: claimBody({ claimType: 'hospitalization', amount: 1000 }) })).body.claimId;
    const cases = [
      [() => t.call('GET', '/claims/CNOPE', { token: t.tokens.ADJUSTER }), 404, 'NOT_FOUND'],
      [() => t.call('POST', '/claims', { token: t.tokens.ADJUSTER, body: claimBody() }), 403, 'FORBIDDEN'],
      [() => t.call('POST', '/claims', { token: c.token, body: claimBody({ documents: 'x' }) }), 400, 'INVALID_INPUT'],
      [() => t.call('POST', `/claims/${id}/settle`, { token: t.tokens.ADJUSTER }), 409, 'NOT_APPROVED'],
      [() => t.call('POST', `/claims/${id}/decision`, { token: t.tokens.ADJUSTER, body: { outcome: 'approve', approvedAmount: 'x' } }), 400, 'INVALID_INPUT'],
    ];
    for (const [call, status, code] of cases) assertEnvelope(await call(), status, code);
  });

  test('TC-Contract-04: a client trace id is echoed so a request can be followed across logs', async () => {
    const res = await t.call('GET', '/claims/CNOPE', { token: c.token, headers: { 'x-trace-id': 'claim-trace-0001' } });
    assert.equal(res.headers.get('x-trace-id'), 'claim-trace-0001');
    assert.equal(res.body.traceId, 'claim-trace-0001');
  });

  test('TC-Contract-05: malformed JSON on the claims route is a 400 envelope, not a 500', async () => {
    const res = await fetch(`${t.base}/claims`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: '{"policyId": "P1", "amount": ',
    });
    const body = await res.json();
    assertEnvelope({ status: res.status, body, headers: res.headers }, 400, 'INVALID_INPUT');
    assert.match(body.message, /Malformed JSON/);
  });
});

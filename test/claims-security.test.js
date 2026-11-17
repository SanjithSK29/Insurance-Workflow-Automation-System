// Security validation of the claims module, per STP §5.1:
//   - "RBAC bypass attempts"            -> TC-Sec-Claim-01..03
//   - "Fuzzing on quote/claim input fields" -> TC-Sec-Claim-04..07
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, pdfDoc } = require('./helpers');
const { today } = require('../src/core/util');

describe('Claims security (STP 5.1)', () => {
  let t;
  let owner;
  let other;
  let policy;
  let claimId;
  before(async () => {
    t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } });
    owner = await t.newCustomer('sec-owner');
    other = await t.newCustomer('sec-other');
    ({ policy } = await t.buyPolicy(owner));
    claimId = (await fileClaim(owner.token)).body.claimId;
  });
  after(() => t.close());

  function fileClaim(token, extra = {}) {
    return t.call('POST', '/claims', {
      token,
      body: { policyId: policy.policyId, claimType: 'hospitalization', amount: 12000, incidentDate: today(), documents: [pdfDoc()], ...extra },
    });
  }

  test('TC-Sec-Claim-01: RBAC matrix: each role can reach only the claim endpoints its job needs', async () => {
    const who = {
      owner: () => owner.token,
      otherCustomer: () => other.token,
      agent: () => t.tokens.AGENT, // this customer is not in the agent's portfolio
      underwriter: () => t.tokens.UNDERWRITER,
      adjuster: () => t.tokens.ADJUSTER,
      admin: () => t.tokens.ADMIN,
    };
    // Expected status per endpoint. 400/409 for the adjuster mean "allowed in,
    // then stopped by validation", i.e. RBAC let the request through.
    const matrix = [
      ['view claim', (tk) => t.call('GET', `/claims/${claimId}`, { token: tk }),
        { owner: 200, otherCustomer: 403, agent: 403, underwriter: 200, adjuster: 200, admin: 200 }],
      ['add documents', (tk) => t.call('POST', `/claims/${claimId}/documents`, { token: tk, body: { documents: [pdfDoc()] } }),
        { owner: 201, otherCustomer: 403, agent: 403, underwriter: 403, adjuster: 403, admin: 403 }],
      ['decide', (tk) => t.call('POST', `/claims/${claimId}/decision`, { token: tk, body: { outcome: 'approve', approvedAmount: 'x' } }),
        { owner: 403, otherCustomer: 403, agent: 403, underwriter: 403, adjuster: 400, admin: 403 }],
      ['settle', (tk) => t.call('POST', `/claims/${claimId}/settle`, { token: tk }),
        { owner: 403, otherCustomer: 403, agent: 403, underwriter: 403, adjuster: 409, admin: 403 }],
      ['file on this policy', (tk) => fileClaim(tk, { claimType: 'accident', amount: 100 }),
        { owner: 201, otherCustomer: 403, agent: 403, underwriter: 403, adjuster: 403, admin: 403 }],
    ];
    const failures = [];
    for (const [name, call, expected] of matrix) {
      for (const [role, token] of Object.entries(who)) {
        const res = await call(token());
        if (res.status !== expected[role]) failures.push(`${name} as ${role}: expected ${expected[role]}, got ${res.status}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test('TC-Sec-Claim-02: every claim endpoint refuses anonymous and forged tokens', async () => {
    const [header, payload, sig] = owner.token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = [header, Buffer.from(JSON.stringify({ ...claims, role: 'ADJUSTER' })).toString('base64url'), sig].join('.');
    const unsigned = [header, payload, ''].join('.');
    const calls = [
      (tk) => t.call('GET', '/claims', { token: tk }),
      (tk) => t.call('GET', `/claims/${claimId}`, { token: tk }),
      (tk) => fileClaim(tk),
      (tk) => t.call('POST', `/claims/${claimId}/settle`, { token: tk }),
    ];
    for (const call of calls) {
      for (const tk of [undefined, forged, unsigned, 'garbage']) {
        const res = await call(tk);
        assert.equal(res.status, 401, `token ${String(tk).slice(0, 12)}…`);
      }
    }
  });

  test('TC-Sec-Claim-03: the claimant never sees fraud scores or internal tasks (agents: TC-Claim-08)', async () => {
    const detail = await t.call('GET', `/claims/${claimId}`, { token: owner.token });
    assert.equal(detail.body.fraudScore, undefined);
    assert.equal(detail.body.fraudFlags, undefined);
    assert.equal(detail.body.tasks, undefined);
    const list = await t.call('GET', '/claims', { token: owner.token });
    assert.ok(list.body.length > 0);
  });

  test('TC-Sec-Claim-04: SQL and script injection strings are stored as plain text, never executed', async () => {
    const payloads = ["'; DROP TABLE claims; --", '<script>alert(1)</script>', "\" OR 1=1 --", '${7*7}'];
    for (const p of payloads) {
      const res = await fileClaim(owner.token, { claimType: 'accident', amount: 10, description: p });
      assert.equal(res.status, 201, p);
      assert.equal(res.body.description, p, 'returned verbatim (JSON-encoded), not interpreted');
    }
    assert.ok(t.ctx.db.get('SELECT COUNT(*) AS n FROM claims').n > 0, 'claims table still exists');
    const byInjectedId = await t.call('GET', `/claims/${encodeURIComponent("' OR '1'='1")}`, { token: t.tokens.ADJUSTER });
    assert.equal(byInjectedId.status, 404);
    const injectedPolicy = await fileClaim(owner.token, { policyId: "' OR '1'='1" });
    assert.equal(injectedPolicy.status, 404);
    const injectedType = await fileClaim(owner.token, { claimType: "accident' OR '1'='1" });
    assert.equal(injectedType.status, 422);
    const statusFilter = await t.call('GET', `/claims?status=${encodeURIComponent("APPROVED' OR '1'='1")}`, { token: t.tokens.ADJUSTER });
    assert.deepEqual(statusFilter.body, [], 'status filter is a bound parameter');
  });

  test('TC-Sec-Claim-05: uploaded filenames cannot carry paths or control characters', async () => {
    const res = await fileClaim(owner.token, {
      claimType: 'accident', amount: 10,
      documents: [{ ...pdfDoc(), filename: '../../etc/passwd.pdf' }, { ...pdfDoc(), filename: 'a\r\nb\\c.pdf' }],
    });
    assert.equal(res.status, 201);
    const detail = await t.call('GET', `/claims/${res.body.claimId}`, { token: owner.token });
    for (const d of detail.body.documents) assert.doesNotMatch(d.filename, /[/\\\r\n]/, d.filename);
  });

  test('TC-Sec-Claim-06: the amount must be a real number, not something JavaScript can coerce into one', async () => {
    for (const amount of [true, [5], '0x10', {}, null, '', ' ', '1e400', 'NaN', -5]) {
      const res = await fileClaim(owner.token, { claimType: 'accident', amount });
      assert.equal(res.status, 422, `amount ${JSON.stringify(amount)}`);
    }
    for (const amount of [1500, 1500.5, '1500', '1500.50']) {
      const res = await fileClaim(owner.token, { claimType: 'accident', amount });
      assert.equal(res.status, 201, `amount ${JSON.stringify(amount)}`);
    }
  });

  test('TC-Sec-Claim-07: the adjuster\'s approved amount gets the same strict check', async () => {
    const res = await fileClaim(owner.token, { claimType: 'accident', amount: 5000 });
    for (const approvedAmount of [true, [100], '0x10']) {
      const r = await t.call('POST', `/claims/${res.body.claimId}/decision`, { token: t.tokens.ADJUSTER, body: { outcome: 'approve', approvedAmount } });
      assert.equal(r.status, 400, `approvedAmount ${JSON.stringify(approvedAmount)}`);
    }
    const ok = await t.call('POST', `/claims/${res.body.claimId}/decision`, { token: t.tokens.ADJUSTER, body: { outcome: 'approve', approvedAmount: '4000' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.claim.approvedAmount, 4000);
  });
});

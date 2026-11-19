// API edge cases for the Claims service (IWA-F-020..023): input validation,
// listing by role, document upload, decision and settlement guards, remaining
// cover across claims, and the workflow event consumers.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, pdfDoc } = require('./helpers');
const { today, addDays } = require('../src/core/util');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const doc = (mime, buf, filename) => ({ mime, contentBase64: buf.toString('base64'), ...(filename !== undefined ? { filename } : {}) });

describe('Claims API edge cases', () => {
  let t;
  // Many customers log in here, so lift the auth rate limit for this suite.
  before(async () => { t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } }); });
  after(() => t.close());

  const fileClaim = (token, policyId, body = {}) => t.call('POST', '/claims', {
    token,
    body: { policyId, claimType: 'hospitalization', amount: 20000, incidentDate: today(), documents: [pdfDoc()], ...body },
  });
  const decide = (claimId, role, body) => t.call('POST', `/claims/${claimId}/decision`, { token: t.tokens[role], body });

  async function customerWithPolicy(tag, opts) {
    const c = await t.newCustomer(tag);
    const { policy } = await t.buyPolicy(c, opts);
    return { c, policy };
  }

  test('TC-Claim-03: amount, date and policy-period validation return 422', async () => {
    const { c, policy } = await customerWithPolicy('ce1');
    const cases = [
      [{ amount: 0 }, /amount must be a positive number/],
      [{ amount: -50 }, /amount must be a positive number/],
      [{ amount: 'lots' }, /amount must be a positive number/],
      [{ incidentDate: '17-11-2026' }, /incidentDate must be YYYY-MM-DD/],
      [{ incidentDate: undefined }, /incidentDate must be YYYY-MM-DD/],
      [{ incidentDate: addDays(policy.startDate || today(), -1) }, /outside the policy period/],
      [{ claimType: undefined }, /claimType must be one of hospitalization, day-care, accident/],
    ];
    for (const [body, message] of cases) {
      const res = await fileClaim(c.token, policy.policyId, body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(res.body.code, 'INVALID_CLAIM');
      assert.match(res.body.message, message);
    }
  });

  test('TC-Claim-04: claims cannot be filed on a cancelled policy', async () => {
    const { c, policy } = await customerWithPolicy('ce2');
    const cancel = await t.call('POST', `/policies/${policy.policyId}/cancel`, { token: c.token, body: { reason: 'No longer needed' } });
    assert.equal(cancel.status, 200);
    const res = await fileClaim(c.token, policy.policyId);
    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'POLICY_NOT_ACTIVE');
  });

  test('TC-Claim-05: document checks: array only, at most 10, not empty, allowed types', async () => {
    const { c, policy } = await customerWithPolicy('ce3');
    const notArray = await fileClaim(c.token, policy.policyId, { documents: pdfDoc() });
    assert.equal(notArray.status, 400);
    assert.match(notArray.body.message, /documents must be an array/);

    const eleven = await fileClaim(c.token, policy.policyId, { documents: Array.from({ length: 11 }, () => pdfDoc()) });
    assert.equal(eleven.status, 400);
    assert.match(eleven.body.message, /At most 10 documents/);

    const empty = await fileClaim(c.token, policy.policyId, { documents: [{ filename: 'e.pdf', mime: 'application/pdf', contentBase64: '' }] });
    assert.equal(empty.status, 400);
    assert.match(empty.body.message, /is empty/);

    const noMime = await fileClaim(c.token, policy.policyId, { documents: [{ filename: 'x', contentBase64: 'AAAA' }] });
    assert.equal(noMime.status, 400);
    const nullDoc = await fileClaim(c.token, policy.policyId, { documents: [null] });
    assert.equal(nullDoc.status, 400);

    const fakePng = await fileClaim(c.token, policy.policyId, { documents: [doc('image/png', JPEG, 'x.png')] });
    assert.equal(fakePng.status, 400);
    assert.match(fakePng.body.message, /does not match image\/png/);
  });

  test('TC-Claim-06: PNG and JPEG evidence is accepted, filenames are sanitised, and no documents is allowed', async () => {
    const { c, policy } = await customerWithPolicy('ce4');
    const res = await fileClaim(c.token, policy.policyId, {
      documents: [doc('IMAGE/PNG', PNG, 'x-ray<1>.png'), doc('image/jpeg', JPEG)],
    });
    assert.equal(res.status, 201);
    const detail = await t.call('GET', `/claims/${res.body.claimId}`, { token: c.token });
    assert.deepEqual(detail.body.documents.map((d) => d.filename).sort(), ['document-2', 'x-ray_1_.png']);
    assert.deepEqual(detail.body.documents.map((d) => d.mime).sort(), ['image/jpeg', 'image/png']);

    // A claim with no documents is accepted but scores NO_SUPPORTING_DOCUMENTS.
    const bare = await fileClaim(c.token, policy.policyId, { documents: undefined, claimType: 'accident', description: 'x'.repeat(2500) });
    assert.equal(bare.status, 201);
    assert.equal(bare.body.description.length, 2000, 'description is truncated to 2000 characters');
    const staff = await t.call('GET', `/claims/${bare.body.claimId}`, { token: t.tokens.ADJUSTER });
    assert.ok(staff.body.fraudFlags.some((f) => f.code === 'NO_SUPPORTING_DOCUMENTS'));
  });

  test('TC-Claim-07: claim lists are scoped by role and staff can filter by status', async () => {
    const { c, policy } = await customerWithPolicy('ce5');
    const other = await customerWithPolicy('ce5b');
    const mine = await fileClaim(c.token, policy.policyId);
    const theirs = await fileClaim(other.c.token, other.policy.policyId);

    const custList = await t.call('GET', '/claims', { token: c.token });
    assert.deepEqual(custList.body.map((x) => x.claimId), [mine.body.claimId]);

    const agentList = await t.call('GET', '/claims', { token: t.tokens.AGENT });
    assert.equal(agentList.status, 200);
    assert.ok(!agentList.body.some((x) => [mine.body.claimId, theirs.body.claimId].includes(x.claimId)), 'agent only sees own portfolio');

    const all = await t.call('GET', '/claims', { token: t.tokens.ADJUSTER });
    for (const id of [mine.body.claimId, theirs.body.claimId]) assert.ok(all.body.some((x) => x.claimId === id));

    await decide(theirs.body.claimId, 'ADJUSTER', { outcome: 'reject' });
    const rejected = await t.call('GET', '/claims?status=REJECTED', { token: t.tokens.ADJUSTER });
    assert.ok(rejected.body.every((x) => x.status === 'REJECTED'));
    assert.ok(rejected.body.some((x) => x.claimId === theirs.body.claimId));

    const alias = await t.call('GET', `/claim/${mine.body.claimId}`, { token: c.token });
    assert.equal(alias.status, 200, '/claim is an alias of /claims');
    const missing = await t.call('GET', '/claims/CNOPE', { token: t.tokens.ADJUSTER });
    assert.equal(missing.status, 404);
    const foreign = await t.call('GET', `/claims/${theirs.body.claimId}`, { token: c.token });
    assert.equal(foreign.status, 403);
  });

  test('TC-Claim-08: agents file and list claims for customers in their portfolio', async () => {
    const agent = t.tokens.AGENT;
    const profile = await t.call('POST', '/customers', {
      token: agent,
      body: { name: 'Agent Client', dob: '1985-03-10', income: 900000, phone: '9876509999', aadhaar: '234512349999', pan: 'ABCPA9999Z' },
    });
    assert.equal(profile.status, 201);
    const { policy } = await t.buyPolicy({ token: agent, customerId: profile.body.id });
    const res = await fileClaim(agent, policy.policyId);
    assert.equal(res.status, 201);
    const list = await t.call('GET', '/claims', { token: agent });
    assert.ok(list.body.some((x) => x.claimId === res.body.claimId));
    const detail = await t.call('GET', `/claims/${res.body.claimId}`, { token: agent });
    assert.equal(detail.body.fraudScore, undefined, 'fraud details hidden from agents');
    assert.equal(detail.body.tasks, undefined);
  });

  test('TC-Claim-09: extra documents can be added to open claims only, by the claimant side only', async () => {
    const { c, policy } = await customerWithPolicy('ce6');
    const claim = await fileClaim(c.token, policy.policyId);
    const add = await t.call('POST', `/claims/${claim.body.claimId}/documents`, { token: c.token, body: { documents: [doc('image/png', PNG, 'bill.png')] } });
    assert.equal(add.status, 201);
    assert.equal(add.body.documentIds.length, 1);
    assert.ok(t.ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'CLAIM_DOCUMENTS_ADDED' AND entity_id = ?", claim.body.claimId));

    const adjuster = await t.call('POST', `/claims/${claim.body.claimId}/documents`, { token: t.tokens.ADJUSTER, body: { documents: [pdfDoc()] } });
    assert.equal(adjuster.status, 403);

    await decide(claim.body.claimId, 'ADJUSTER', { outcome: 'reject' });
    const closed = await t.call('POST', `/claims/${claim.body.claimId}/documents`, { token: c.token, body: { documents: [pdfDoc()] } });
    assert.equal(closed.status, 409);
    assert.equal(closed.body.code, 'CLAIM_CLOSED');
  });

  test('TC-WF-03: decision guards: unknown claim, wrong role step, invalid approved amount', async () => {
    const { c, policy } = await customerWithPolicy('ce7');
    const claim = await fileClaim(c.token, policy.policyId, { amount: 30000 });
    const id = claim.body.claimId;

    assert.equal((await decide('CNOPE', 'ADJUSTER', { outcome: 'approve' })).status, 404);
    const admin = await decide(id, 'ADMIN', { outcome: 'approve' });
    assert.equal(admin.status, 403, 'senior step is not open yet');
    const customer = await t.call('POST', `/claims/${id}/decision`, { token: c.token, body: { outcome: 'approve' } });
    assert.equal(customer.status, 403);

    for (const approvedAmount of [-1, 30000.01, 'abc']) {
      const r = await decide(id, 'ADJUSTER', { outcome: 'approve', approvedAmount });
      assert.equal(r.status, 400, String(approvedAmount));
    }
    // An empty approvedAmount means "approve the claimed amount".
    const ok = await decide(id, 'ADJUSTER', { outcome: 'approve', approvedAmount: '' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.claim.status, 'APPROVED');
    assert.equal(ok.body.claim.settlement.approvedAmount, 30000);
  });

  test('TC-Settle-08: settlement guards: unknown claim, not yet approved, wrong role', async () => {
    const { c, policy } = await customerWithPolicy('ce8');
    const claim = await fileClaim(c.token, policy.policyId);
    const id = claim.body.claimId;
    assert.equal((await t.call('POST', '/claims/CNOPE/settle', { token: t.tokens.ADJUSTER })).status, 404);
    const early = await t.call('POST', `/claims/${id}/settle`, { token: t.tokens.ADJUSTER });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'NOT_APPROVED');
    await decide(id, 'ADJUSTER', { outcome: 'approve' });
    assert.equal((await t.call('POST', `/claims/${id}/settle`, { token: c.token })).status, 403);
    assert.equal((await t.call('POST', `/claims/${id}/settle`, { token: t.tokens.ADMIN })).status, 403);
    const done = await t.call('POST', `/claims/${id}/settle`, { token: t.tokens.ADJUSTER });
    assert.equal(done.status, 200);
    const again = await t.call('POST', `/claims/${id}/settle`, { token: t.tokens.ADJUSTER });
    assert.equal(again.status, 409, 'a settled claim cannot be paid twice');
  });

  test('TC-Settle-09: remaining cover drops by the amount paid, and the next claim is capped and flagged', async () => {
    const { c, policy } = await customerWithPolicy('ce9', { sumInsured: 100000 });
    const first = await fileClaim(c.token, policy.policyId, { amount: 90000 });
    // 90 % of the cover a few days after purchase: the Sprint 4 RAPID_INCEPTION_HIGH_VALUE
    // rule sends it to fraud investigation first, which the adjuster clears.
    const firstStaff = await t.call('GET', `/claims/${first.body.claimId}`, { token: t.tokens.ADJUSTER });
    assert.ok(firstStaff.body.fraudFlags.some((f) => f.code === 'RAPID_INCEPTION_HIGH_VALUE'));
    await decide(first.body.claimId, 'ADJUSTER', { outcome: 'approve', comment: 'Cleared' });
    await decide(first.body.claimId, 'ADJUSTER', { outcome: 'approve' });
    const paid = await t.call('POST', `/claims/${first.body.claimId}/settle`, { token: t.tokens.ADJUSTER });
    assert.equal(paid.body.settlement.payableAmount, 76500);

    // 100,000 - 76,500 paid = 23,500 left, so a 30,000 claim exceeds the remaining cover.
    const second = await fileClaim(c.token, policy.policyId, { amount: 30000, claimType: 'accident' });
    const staff = await t.call('GET', `/claims/${second.body.claimId}`, { token: t.tokens.ADJUSTER });
    assert.ok(staff.body.fraudFlags.some((f) => f.code === 'EXCEEDS_REMAINING_COVER'));
    assert.equal(staff.body.tasks[0].name, 'Fraud investigation');
    assert.equal(second.body.eta, '10 days', 'flagged claims get the longer ETA');

    await decide(second.body.claimId, 'ADJUSTER', { outcome: 'approve', comment: 'Cleared' });
    const approved = await decide(second.body.claimId, 'ADJUSTER', { outcome: 'approve' });
    assert.equal(approved.body.claim.status, 'APPROVED');
    const s = approved.body.claim.settlement;
    assert.equal(s.remainingCover, 23500);
    assert.equal(s.eligibleAmount, 23500);
    assert.equal(s.payableAmount, 16650);
  });

  test('TC-Claim-10: workflow event consumers ignore other processes and unknown claims, and clamp approved amounts', async () => {
    const { c, policy } = await customerWithPolicy('ce10');
    const claim = await fileClaim(c.token, policy.policyId, { amount: 40000 });
    const id = claim.body.claimId;
    const row = () => ({ ...t.ctx.db.get('SELECT status, approved_amount FROM claims WHERE id = ?', id) });
    const { bus } = t.ctx;

    bus.publish('workflow.task.created', { businessKey: id, definitionKey: 'other-process', name: 'X', candidateGroup: 'ADMIN' });
    bus.publish('workflow.task.created', { businessKey: 'CNOPE', definitionKey: 'claim-approval', name: 'X', candidateGroup: 'ADMIN' });
    bus.publish('workflow.completed', { businessKey: id, definitionKey: 'other-process', result: 'APPROVED' });
    bus.publish('workflow.completed', { businessKey: 'CNOPE', definitionKey: 'claim-approval', result: 'APPROVED' });
    bus.publish('workflow.task.completed', { businessKey: 'CNOPE', variables: { approvedAmount: 5 } });
    bus.publish('workflow.task.completed', { businessKey: id, variables: {} });
    assert.deepEqual(row(), { status: 'UNDER_REVIEW', approved_amount: null });

    bus.publish('workflow.task.completed', { businessKey: id, variables: { approvedAmount: 999999 } });
    assert.equal(row().approved_amount, 40000, 'capped at the claimed amount');
    bus.publish('workflow.task.completed', { businessKey: id, variables: { approvedAmount: -10 } });
    assert.equal(row().approved_amount, 0, 'never negative');
    bus.publish('workflow.task.completed', { businessKey: id, variables: { approvedAmount: 'n/a' } });
    assert.equal(row().approved_amount, 0, 'non-numeric becomes 0');
  });
});

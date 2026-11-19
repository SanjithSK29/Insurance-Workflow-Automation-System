// IWA-SR-005 / IWA-F-023: the claim settlement letter is a signed PDF whose
// figures match the settlement formula, that anyone holding the public key can
// verify, and whose signature breaks if a single figure is altered.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp, pdfDoc } = require('./helpers');
const { today } = require('../src/core/util');

describe('Signed settlement letter (SR-005, F-023)', () => {
  let t;
  let c;
  let claimId;
  let settlement;
  before(async () => {
    t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } });
    c = await t.newCustomer('sl1');
    const { policy } = await t.buyPolicy(c, { sumInsured: 100000 });
    // Start the cover 60 days ago so this test is about the letter, not about the
    // early-claim fraud rules (EARLY_CLAIM, RAPID_INCEPTION_HIGH_VALUE).
    t.ctx.db.run("UPDATE policies SET start_date = date('now', '-60 day') WHERE id = ?", policy.policyId);
    const filed = await t.call('POST', '/claims', {
      token: c.token,
      body: { policyId: policy.policyId, claimType: 'hospitalization', amount: 90000, incidentDate: today(), documents: [pdfDoc()] },
    });
    claimId = filed.body.claimId;
    await t.call('POST', `/claims/${claimId}/decision`, { token: t.tokens.ADJUSTER, body: { outcome: 'approve' } });
    settlement = (await t.call('POST', `/claims/${claimId}/settle`, { token: t.tokens.ADJUSTER })).body.settlement;
  });
  after(() => t.close());

  const download = (token) => t.call('GET', `/documents/${settlement.documentId}`, { token });

  test('TC-Settle-10: the letter is a PDF that states the claim, the deductions and the amount paid', async () => {
    const res = await download(c.token);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const text = res.body.toString('latin1');
    assert.ok(text.startsWith('%PDF-'));
    for (const expected of [claimId, 'INR 90,000.00', 'INR 5,000.00', 'INR 8,500.00', 'INR 76,500.00', settlement.payoutReference]) {
      assert.ok(text.includes(expected), `letter mentions ${expected}`);
    }
  });

  test('TC-Settle-11: the signature verifies independently with the published public key', async () => {
    const res = await download(c.token);
    const signature = res.headers.get('x-document-signature');
    assert.ok(signature, 'signature is sent with the document');
    const pem = (await t.call('GET', '/documents/public-key', { token: c.token })).body.toString();
    const publicKey = crypto.createPublicKey(pem);
    assert.equal(crypto.verify(null, res.body, publicKey, Buffer.from(signature, 'base64')), true);
    const sha = crypto.createHash('sha256').update(res.body).digest('hex');
    assert.equal(res.headers.get('x-document-sha256'), sha);
  });

  test('TC-Settle-12: changing the amount paid in the stored letter breaks the signature', async () => {
    const row = t.ctx.db.get('SELECT content FROM documents WHERE id = ?', settlement.documentId);
    const original = Buffer.from(row.content);
    const forged = Buffer.from(original.toString('latin1').replace('76,500.00', '96,500.00'), 'latin1');
    assert.notDeepEqual(forged, original, 'the figure was found and changed');
    t.ctx.db.run('UPDATE documents SET content = ? WHERE id = ?', forged, settlement.documentId);
    try {
      const v = await t.call('GET', `/documents/${settlement.documentId}/verify`, { token: c.token });
      assert.equal(v.body.signatureValid, false);
      assert.equal(v.body.integrityValid, false);
    } finally {
      t.ctx.db.run('UPDATE documents SET content = ? WHERE id = ?', original, settlement.documentId);
    }
  });

  test('TC-Settle-13: only the claimant and staff can download the letter', async () => {
    const stranger = await t.newCustomer('sl2');
    assert.equal((await download(stranger.token)).status, 403);
    assert.equal((await download(t.tokens.AGENT)).status, 403);
    assert.equal((await download(t.tokens.ADJUSTER)).status, 200);
  });
});

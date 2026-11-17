// IWA-F-010 / IWA-SR-005: generated documents, the PDF writer and document
// access rules (owner: Samarth).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { buildPdf } = require('../src/modules/pdf');

describe('PDF text encoding', () => {
  test('TC-PDF-03: Latin accented names print as written; typographic punctuation is simplified (DEF-12)', () => {
    const text = buildPdf({ title: 'Zoë', lines: ['Policyholder: Zoë Müller – “José” ₹500 …'] }).toString('latin1');
    assert.ok(text.includes('Policyholder: Zo\xEB M\xFCller - "Jos\xE9" INR 500 ...'), 'accents kept, punctuation mapped');
    assert.ok(text.includes('/Title (Zo\xEB)'));
  });

  test('TC-PDF-04: characters outside the PDF font (e.g. Devanagari) become ? instead of breaking the file', () => {
    const pdf = buildPdf({ lines: ['नाम: Asha'] });
    const text = pdf.toString('latin1');
    assert.ok(text.includes('(???: Asha)'), 'one ? per code point');
    const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
    assert.equal(text.slice(xref, xref + 4), 'xref', 'byte offsets still valid');
  });
});

describe('Policy documents with accented names', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(() => t.close());

  test('TC-Policy-03: the policy schedule shows the policyholder name exactly (DEF-12)', async () => {
    const c = await t.newCustomer('pdf1', { name: 'Zoë Fernández' });
    const { policy } = await t.buyPolicy(c);
    const pdf = await t.call('GET', `/documents/${policy.documentId}`, { token: c.token });
    assert.ok(pdf.body.toString('latin1').includes('Policyholder: Zo\xEB Fern\xE1ndez'));
    const verify = await t.call('GET', `/documents/${policy.documentId}/verify`, { token: c.token });
    assert.equal(verify.body.signatureValid, true);
  });
});

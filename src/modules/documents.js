// Document Service: stores uploaded claim documents and generated, digitally
// signed PDFs (IWA-F-010, IWA-F-013, IWA-SR-005). Content lives in the DB here;
// in production the same API fronts S3-compatible object storage.
const express = require('express');
const { newId, nowIso } = require('../core/db');
const { sha256 } = require('../security/crypto');
const { buildPdf } = require('./pdf');
const { notFound, forbidden } = require('../core/errors');

const SIGNED_KINDS = new Set(['POLICY', 'INVOICE', 'SETTLEMENT', 'RENEWAL', 'CANCELLATION']);

module.exports = function documentsModule(ctx) {
  const { db, crypto } = ctx;

  function store({ kind, ownerCustomerId = null, referenceId = null, filename, mime, content, sign = false }) {
    const doc = {
      id: newId('D'),
      kind,
      filename,
      mime,
      size: content.length,
      sha256: sha256(content),
      signature: sign ? crypto.sign(content) : null,
    };
    db.run(
      `INSERT INTO documents (id, kind, owner_customer_id, reference_id, filename, mime, size, sha256, signature, content, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      doc.id, kind, ownerCustomerId, referenceId, filename, mime, doc.size, doc.sha256, doc.signature, content, nowIso(),
    );
    return doc;
  }

  // Render + sign a PDF. The signature covers the exact PDF bytes; a signature
  // block with the document fingerprint is printed on the document itself.
  function generateSignedPdf({ kind, ownerCustomerId, referenceId, filename, title, lines }) {
    const pdf = buildPdf({
      title,
      lines: [
        ...lines,
        { rule: true, gap: 10 },
        { text: 'Digitally signed by IWAS Document Service (Ed25519).', size: 8 },
        { text: 'Verify at GET /api/v1/documents/<id>/verify or with the published public key.', size: 8 },
      ],
    });
    return store({ kind, ownerCustomerId, referenceId, filename, mime: 'application/pdf', content: pdf, sign: SIGNED_KINDS.has(kind) });
  }

  function verify(id) {
    const doc = db.get('SELECT * FROM documents WHERE id = ?', id);
    if (!doc) throw notFound('Document');
    const content = Buffer.from(doc.content);
    const intact = sha256(content) === doc.sha256;
    return {
      documentId: doc.id,
      kind: doc.kind,
      sha256: doc.sha256,
      signed: !!doc.signature,
      integrityValid: intact,
      signatureValid: doc.signature ? crypto.verify(content, doc.signature) : null,
    };
  }

  // Customers may only read their own documents; staff read all.
  function assertCanRead(user, doc) {
    if (user.role === 'CUSTOMER') {
      const own = db.get('SELECT id FROM customers WHERE user_id = ? AND id = ?', user.id, doc.owner_customer_id);
      if (!own) throw forbidden('Not your document');
    } else if (user.role === 'AGENT') {
      const own = db.get('SELECT id FROM customers WHERE agent_id = ? AND id = ?', user.id, doc.owner_customer_id);
      if (!own) throw forbidden('Customer is not in your portfolio');
    }
  }

  const router = express.Router();

  router.get('/public-key', (req, res) => res.type('text/plain').send(crypto.publicKeyPem()));

  router.get('/:id', (req, res) => {
    const doc = db.get('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!doc) throw notFound('Document');
    assertCanRead(req.user, doc);
    res.set({
      'Content-Type': doc.mime,
      'Content-Disposition': `inline; filename="${doc.filename.replace(/"/g, '')}"`,
      'X-Document-SHA256': doc.sha256,
      ...(doc.signature ? { 'X-Document-Signature': doc.signature } : {}),
    });
    res.send(Buffer.from(doc.content));
  });

  router.get('/:id/verify', (req, res) => {
    const doc = db.get('SELECT owner_customer_id FROM documents WHERE id = ?', req.params.id);
    if (!doc) throw notFound('Document');
    assertCanRead(req.user, doc);
    res.json(verify(req.params.id));
  });

  return { store, generateSignedPdf, verify, router };
};

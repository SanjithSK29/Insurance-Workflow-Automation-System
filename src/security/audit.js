// Immutable audit trail (IWA-F-034). Rows are append-only (DB triggers) and
// hash-chained, so editing or removing any row breaks verification.
const { sha256 } = require('./crypto');
const { redactPii } = require('./pii');
const { nowIso } = require('../core/db');

const GENESIS = '0'.repeat(64);

const rowHash = (r) =>
  sha256([r.prev_hash, r.ts, r.actor, r.action, r.entity, r.entity_id ?? '', r.details].join('|'));

function createAudit(db) {
  return {
    record(actor, action, entity, entityId, details = {}) {
      const last = db.get('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1');
      const row = {
        ts: nowIso(),
        actor: actor || 'system',
        action,
        entity,
        entity_id: entityId ?? null,
        details: redactPii(JSON.stringify(details)),
        prev_hash: last ? last.hash : GENESIS,
      };
      row.hash = rowHash(row);
      db.run(
        'INSERT INTO audit_log (ts, actor, action, entity, entity_id, details, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?)',
        row.ts, row.actor, row.action, row.entity, row.entity_id, row.details, row.prev_hash, row.hash,
      );
      return row;
    },

    verify() {
      let prev = GENESIS;
      let expectedSeq = null;
      for (const r of db.all('SELECT * FROM audit_log ORDER BY seq')) {
        if (expectedSeq !== null && r.seq !== expectedSeq) return { valid: false, brokenAt: expectedSeq, reason: 'missing entry' };
        if (r.prev_hash !== prev) return { valid: false, brokenAt: r.seq, reason: 'chain link mismatch' };
        if (rowHash(r) !== r.hash) return { valid: false, brokenAt: r.seq, reason: 'entry contents changed' };
        prev = r.hash;
        expectedSeq = r.seq + 1;
      }
      const count = db.get('SELECT COUNT(*) AS n FROM audit_log').n;
      return { valid: true, entries: count };
    },

    list({ entity, entityId, limit = 200 } = {}) {
      const where = [];
      const params = [];
      if (entity) { where.push('entity = ?'); params.push(entity); }
      if (entityId) { where.push('entity_id = ?'); params.push(entityId); }
      const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ?`;
      return db.all(sql, ...params, Math.min(Number(limit) || 200, 1000));
    },
  };
}

module.exports = { createAudit };

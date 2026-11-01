// IWA-NF-001 response time, plus unit tests for the workflow parser, the
// expression evaluator, resilience helpers and the PDF writer.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { parseBpmn } = require('../src/workflow/bpmn');
const { evaluateExpression } = require('../src/workflow/expression');
const { CircuitBreaker, retry } = require('../src/core/resilience');
const { buildPdf } = require('../src/modules/pdf');

describe('Performance (IWA-NF-001)', () => {
  let t;
  before(async () => { t = await startApp({ rateLimit: { windowMs: 60_000, max: 10_000, publicMax: 10_000 } }); });
  after(() => t.close());

  test('TC-Perf-01: quote and claim-status APIs respond within 2s at the 95th percentile', async () => {
    const c = await t.newCustomer('perf');
    const { policy } = await t.buyPolicy(c);
    const claim = await t.call('POST', '/claims', { token: c.token, body: { policyId: policy.policyId, claimType: 'accident', amount: 5000, incidentDate: policy.startDate } });
    const timings = [];
    const timed = async (fn) => { const s = performance.now(); const r = await fn(); timings.push(performance.now() - s); return r; };
    const batch = [];
    for (let i = 0; i < 200; i++) {
      batch.push(timed(() => t.call('POST', '/quote', { body: { age: 25 + (i % 30), income: 600000, coverageType: i % 2 ? 'health' : 'life', term: 1 } })));
      batch.push(timed(() => t.call('GET', `/claims/${claim.body.claimId}`, { token: c.token })));
      if (batch.length >= 20) await Promise.all(batch.splice(0));
    }
    await Promise.all(batch);
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)];
    assert.ok(p95 < 2000, `p95 = ${p95.toFixed(1)}ms`);
  });
});

describe('Unit: workflow, resilience, PDF', () => {
  test('expression evaluator handles comparisons, logic and rejects code', () => {
    const vars = { amount: 150000, fraudFlagged: false, outcome: 'approve' };
    assert.equal(evaluateExpression('${amount > 100000 && fraudFlagged == false}', vars), true);
    assert.equal(evaluateExpression("${outcome == 'reject' || (amount <= 10)}", vars), false);
    assert.equal(evaluateExpression('${!fraudFlagged}', vars), true);
    assert.throws(() => evaluateExpression('${process.exit(1)}', vars));
    assert.throws(() => evaluateExpression('${amount > }', vars));
  });

  test('BPMN validator catches structural errors', () => {
    const wrap = (body) => `<definitions><process id="p">${body}</process></definitions>`;
    assert.throws(() => parseBpmn(wrap('<endEvent id="e"/>')), /startEvent/);
    assert.throws(() => parseBpmn(wrap('<startEvent id="s"/><sequenceFlow id="f" sourceRef="s" targetRef="t"/><userTask id="t"/><sequenceFlow id="f2" sourceRef="t" targetRef="e"/><endEvent id="e"/>')), /candidateGroups/);
    assert.throws(() => parseBpmn(wrap('<startEvent id="s"/><sequenceFlow id="f" sourceRef="s" targetRef="e"/><endEvent id="e"/><endEvent id="orphan"/>')), /unreachable/);
    const ok = parseBpmn(wrap('<startEvent id="s"/><sequenceFlow id="f" sourceRef="s" targetRef="e"/><endEvent id="e"/>'));
    assert.equal(Object.keys(ok.nodes).length, 2);
  });

  test('circuit breaker opens after repeated failures and half-opens after the reset window', async () => {
    let now = 0;
    const cb = new CircuitBreaker('x', { failureThreshold: 2, resetMs: 1000, now: () => now });
    const fail = () => Promise.reject(new Error('down'));
    await assert.rejects(cb.call(fail));
    await assert.rejects(cb.call(fail));
    assert.equal(cb.state, 'OPEN');
    await assert.rejects(cb.call(() => Promise.resolve(1)), /open/);
    now = 1500;
    assert.equal(await cb.call(() => Promise.resolve(1)), 1);
    assert.equal(cb.state, 'CLOSED');
  });

  test('retry uses exponential backoff and stops on non-retryable errors', async () => {
    let calls = 0;
    const result = await retry(async () => { calls++; if (calls < 3) throw new Error('x'); return 'ok'; }, { attempts: 3, baseMs: 1 });
    assert.equal(result, 'ok');
    calls = 0;
    await assert.rejects(retry(async () => { calls++; throw new Error('fatal'); }, { attempts: 5, baseMs: 1, isRetryable: () => false }));
    assert.equal(calls, 1);
  });

  test('PDF writer produces a structurally valid multi-page document', () => {
    const pdf = buildPdf({ title: 'T', lines: Array.from({ length: 120 }, (_, i) => `Line ${i} (with parens) \\ backslash`) });
    const text = pdf.toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4'));
    assert.match(text, /\/Count 3 /);
    const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
    assert.equal(text.slice(xref, xref + 4), 'xref');
  });
});

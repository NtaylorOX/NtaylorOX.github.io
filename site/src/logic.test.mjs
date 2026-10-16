// node site/src/logic.test.mjs   (no dependencies)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const L = createRequire(import.meta.url)('./logic.js');

// Known reference values for the KV-cache and decode-throughput maths
assert.equal(L.kvBytesPerToken(L.SPECS['llama3-8b']), 131072);
const p8 = L.plan(L.SPECS['llama3-8b'], 80, 1, 8192, 2, 2);
assert.ok(p8.fits && Math.abs(p8.weights - 16) < 1e-9 && p8.concurrent > 30);
assert.ok(!L.plan(L.SPECS['llama3-70b'], 80, 1, 8192, 2, 2).fits);
assert.ok(L.plan(L.SPECS['llama3-70b'], 80, 4, 8192, 2, 2).fits);
assert.ok(L.plan(L.SPECS['llama3-70b'], 80, 1, 8192, 0.5, 2).fits);
const one = L.decodeTps(L.SPECS['llama3-8b'], 3350, 1, 2, 1);
assert.ok(one > 150 && one < 250);
assert.ok(Math.abs(L.decodeTps(L.SPECS['llama3-8b'], 3350, 1, 2, 8) - 8 * one) < 1e-6);

// Batching: conservation, and continuous never slower than static
for (const [n, B, seed] of [[40, 8, 1], [30, 6, 2], [48, 16, 3], [9, 4, 4]]) {
  const lens = L.lengths(n, seed);
  const s = L.staticSchedule(lens, B), c = L.continuousSchedule(lens, B);
  for (const sch of [s, c]) {
    assert.equal(sch.segments.length, n);
    assert.deepEqual(sch.segments.map(g => g.end - g.start).sort((a, b) => a - b), [...lens].sort((a, b) => a - b));
    // no two requests overlap in one slot
    for (let slot = 0; slot < B; slot++) {
      const g = sch.segments.filter(x => x.slot === slot).sort((a, b) => a.start - b.start);
      for (let i = 1; i < g.length; i++) assert.ok(g[i].start >= g[i - 1].end);
    }
  }
  assert.ok(c.total <= s.total && c.meanLatency <= s.meanLatency + 1e-9);
}
assert.equal(L.staticSchedule([5, 5], 2).total, 5);
assert.equal(L.continuousSchedule([5, 5], 2).total, 5);

// Evaluation noise: interval contains the observed accuracy; wider for smaller n; itemsFor matches the formula
const a = L.evalNoise(0.7, 100, 7), b = L.evalNoise(0.7, 1600, 7);
assert.ok(a.lo < a.phat && a.phat < a.hi && b.lo < b.phat && b.phat < b.hi);
assert.ok(a.halfWidth > 2 * b.halfWidth);
assert.equal(a.means.length, 2000);
assert.equal(L.itemsFor(0.5, 0.02), 2401);
// Guardrails: normal CDF sanity, symmetric detector, and the base-rate effect on precision
assert.ok(Math.abs(L.phi(0) - 0.5) < 1e-6 && Math.abs(L.phi(1.96) - 0.975) < 1e-3 && Math.abs(L.phi(-1) - 0.1587) < 1e-3);
const g = L.guardrail(3, 1.5, 0.01);                      // d'=3, threshold midway => TPR = 1 - FPR
assert.ok(Math.abs(g.tpr - (1 - g.fpr)) < 1e-6 && Math.abs(g.tpr - 0.9332) < 2e-3);
assert.ok(g.precision > 0.10 && g.precision < 0.15);       // ~12%: most alerts are false at a 1% base rate
assert.ok(L.guardrail(3, 1.5, 0.2).precision > 0.7);       // same detector, common threat: mostly real alerts
assert.ok(Math.abs(g.caught + g.missed - g.unsafe) < 1e-6);
assert.ok(L.guardrail(3, 3.5, 0.01).fpr < g.fpr && L.guardrail(3, 3.5, 0.01).tpr < g.tpr);  // stricter threshold: fewer alerts, more misses
console.log('logic.test.mjs: all checks passed');

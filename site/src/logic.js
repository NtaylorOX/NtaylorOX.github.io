/* Pure logic for the interactive notes. No DOM.
   Checked by logic.test.mjs against known values (memory sizes, scheduler invariants, normal-CDF identities). */

const SPECS = {
  'llama3-8b':  { name: 'Llama 3 8B',  params: 8.0,  layers: 32, kvHeads: 8, headDim: 128 },
  'qwen3-8b':   { name: 'Qwen3 8B',    params: 8.2,  layers: 36, kvHeads: 8, headDim: 128 },
  'qwen3-32b':  { name: 'Qwen3 32B',   params: 32.8, layers: 64, kvHeads: 8, headDim: 128 },
  'llama3-70b': { name: 'Llama 3 70B', params: 70.6, layers: 80, kvHeads: 8, headDim: 128 },
};
/* Approximate public specs (GB of memory, GB/s of bandwidth). Verify before relying on them. */
const GPUS = {
  l4:      { name: 'L4 24 GB',      gb: 24, bw: 300 },
  rtx4090: { name: 'RTX 4090 24 GB', gb: 24, bw: 1008 },
  l40s:    { name: 'L40S 48 GB',    gb: 48, bw: 864 },
  a100:    { name: 'A100 80 GB',    gb: 80, bw: 2039 },
  h100:    { name: 'H100 80 GB',    gb: 80, bw: 3350 },
};

function kvBytesPerToken(spec, kvBytes) {
  return 2 * spec.layers * spec.kvHeads * spec.headDim * (kvBytes === undefined ? 2 : kvBytes);
}

/* Per-GPU memory plan under tensor parallelism (weights and KV heads shard ~1/tp). */
function plan(spec, gpuGb, tp, ctx, weightBytes, kvBytes, util, overheadFrac) {
  util = util === undefined ? 0.90 : util;
  overheadFrac = overheadFrac === undefined ? 0.08 : overheadFrac;
  const weights = spec.params * weightBytes / tp;               // GB (params in billions)
  const usable = gpuGb * util;
  const overhead = gpuGb * overheadFrac;
  const pool = usable - weights - overhead;
  const fits = pool > 0;
  const kvShard = Math.min(tp, spec.kvHeads);
  const perTok = kvBytesPerToken(spec, kvBytes) / kvShard;      // bytes per token per GPU
  const maxTokens = fits ? Math.floor(pool * 1e9 / perTok) : 0;
  return {
    fits, weights, overhead, pool: Math.max(pool, 0), reserve: gpuGb - usable,
    maxTokens, concurrent: fits ? Math.floor(maxTokens / ctx) : 0, bytesPerToken: perTok,
  };
}

/* Memory-bound decode roofline, tokens/s per sequence at batch 1 (times batch if shared weights streams). */
function decodeTps(spec, bwGBs, tp, weightBytes, batch) {
  const bytesPerStep = spec.params * 1e9 * weightBytes / tp;
  return (batch || 1) * bwGBs * 1e9 / bytesPerStep;
}

/* ---------- seeded randomness ---------- */
function rng(seed) {
  let s = seed >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function normal(r) {
  const u1 = Math.max(r(), 1e-12), u2 = r();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/* ---------- batching ---------- */
function lengths(n, seed, mu, sigma) {
  const r = rng(seed);
  mu = mu === undefined ? 2.6 : mu; sigma = sigma === undefined ? 0.8 : sigma;
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.floor(Math.exp(mu + sigma * normal(r))) + 1);
  return out;
}

function summarize(segments, idle, B, total) {
  const ends = segments.map(function (s) { return s.end; });
  return { segments: segments, idle: idle, slots: B, total: total,
           meanLatency: ends.reduce(function (a, b) { return a + b; }, 0) / ends.length };
}

/* Static: run B requests, wait for the longest, then take the next B. */
function staticSchedule(lens, B) {
  const segments = [], idle = [];
  let t = 0;
  for (let i = 0; i < lens.length; i += B) {
    const batch = lens.slice(i, i + B);
    const longest = Math.max.apply(null, batch);
    batch.forEach(function (len, j) {
      segments.push({ id: i + j, slot: j, start: t, end: t + len });
      if (len < longest) idle.push({ slot: j, start: t + len, end: t + longest });
    });
    t += longest;
  }
  return summarize(segments, idle, B, t);
}

/* Continuous: refill a slot as soon as its request finishes. */
function continuousSchedule(lens, B) {
  const queue = lens.map(function (len, id) { return { id: id, len: len }; });
  let qi = 0, t = 0;
  const slots = new Array(B).fill(null), segments = [];
  while (qi < queue.length || slots.some(function (s) { return s !== null; })) {
    for (let s = 0; s < B; s++) {
      if (slots[s] === null && qi < queue.length) {
        const q = queue[qi++];
        slots[s] = { id: q.id, rem: q.len, start: t };
      }
    }
    t += 1;
    for (let s = 0; s < B; s++) {
      const x = slots[s];
      if (x === null) continue;
      x.rem -= 1;
      if (x.rem === 0) { segments.push({ id: x.id, slot: s, start: x.start, end: t }); slots[s] = null; }
    }
  }
  const lastEnd = new Array(B).fill(0);
  segments.forEach(function (g) { lastEnd[g.slot] = Math.max(lastEnd[g.slot], g.end); });
  const idle = [];
  for (let s = 0; s < B; s++) if (lastEnd[s] < t) idle.push({ slot: s, start: lastEnd[s], end: t });
  return summarize(segments, idle, B, t);
}

/* ---------- evaluation noise ---------- */
/* One evaluation run of n items at true accuracy p, then the resampling distribution of its accuracy.
   The resample counts use a normal approximation of Binomial(n, phat); fine for the sizes shown here. */
function evalNoise(p, n, seed, draws) {
  draws = draws || 2000;
  const r = rng(seed);
  let k = 0;
  for (let i = 0; i < n; i++) if (r() < p) k++;
  const phat = k / n;
  const sd = Math.sqrt(phat * (1 - phat) * n);
  const means = [];
  for (let b = 0; b < draws; b++) {
    const kb = Math.min(n, Math.max(0, Math.round(k + sd * normal(r))));
    means.push(kb / n);
  }
  means.sort(function (a, b) { return a - b; });
  const lo = means[Math.floor(0.025 * draws)], hi = means[Math.floor(0.975 * draws) - 1];
  return { phat: phat, lo: lo, hi: hi, halfWidth: (hi - lo) / 2, means: means };
}

/* Items needed for a +/- margin (absolute, e.g. 0.02) at accuracy p, 95% normal approximation. */
function itemsFor(p, margin) {
  return Math.ceil(1.96 * 1.96 * p * (1 - p) / (margin * margin));
}

/* ---------- guardrails: a score-threshold classifier on safe vs unsafe traffic ---------- */
/* Standard normal CDF (Abramowitz and Stegun 7.1.26 via erf). */
function phi(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
/* Safe scores ~ N(0,1), unsafe scores ~ N(dprime,1); flag when score > threshold. Counts are per `total` requests. */
function guardrail(dprime, threshold, baseRate, total) {
  total = total || 10000;
  const tpr = 1 - phi(threshold - dprime), fpr = 1 - phi(threshold);
  const unsafe = total * baseRate, safe = total - unsafe;
  const caught = unsafe * tpr, falseAlarms = safe * fpr;
  const flagged = caught + falseAlarms;
  return { tpr: tpr, fpr: fpr, flagged: flagged, caught: caught, falseAlarms: falseAlarms,
           missed: unsafe - caught, precision: flagged > 0 ? caught / flagged : 1, unsafe: unsafe };
}

if (typeof module !== 'undefined') {
  module.exports = { SPECS, GPUS, kvBytesPerToken, plan, decodeTps, rng, lengths,
                     staticSchedule, continuousSchedule, evalNoise, itemsFor, phi, guardrail };
}

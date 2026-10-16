/* DOM and animation. Pure logic lives in logic.js (tested with node). DATA is injected by build_site.py. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  var fmt = function (n, d) { return Number(n).toLocaleString('en-GB', { maximumFractionDigits: d === undefined ? 0 : d, minimumFractionDigits: d === undefined ? 0 : d }); };

  /* ---------------------------------------------------------------- schedule drawing */
  var hatchCache = {};
  function hatch(ctx, color) {
    if (hatchCache[color]) return hatchCache[color];
    var c = document.createElement('canvas'); c.width = 6; c.height = 6;
    var g = c.getContext('2d'); g.strokeStyle = color; g.lineWidth = 1; g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.stroke();
    hatchCache[color] = ctx.createPattern(c, 'repeat');
    return hatchCache[color];
  }
  function sizeCanvas(canvas, cssH) {
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 300;
    canvas.style.height = cssH + 'px';
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(cssH * dpr);
    }
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: cssH };
  }
  function drawSchedule(canvas, sched, maxT, tNow, rowPx) {
    var B = sched.slots, s = sizeCanvas(canvas, B * rowPx), ctx = s.ctx;
    ctx.clearRect(0, 0, s.w, s.h);
    var cols = [css('--seg0'), css('--seg1'), css('--seg2'), css('--seg3')], idleC = css('--idle');
    var x = function (t) { return t / maxT * s.w; };
    ctx.fillStyle = hatch(ctx, idleC);
    sched.idle.forEach(function (g) {
      if (tNow <= g.start) return;
      ctx.fillRect(x(g.start), g.slot * rowPx + 1, Math.max(x(Math.min(g.end, tNow)) - x(g.start) - 1, 0), rowPx - 2);
    });
    sched.segments.forEach(function (g) {
      if (tNow <= g.start) return;
      ctx.fillStyle = cols[g.id % 4];
      ctx.fillRect(x(g.start), g.slot * rowPx + 1, Math.max(x(Math.min(g.end, tNow)) - x(g.start) - 1, 0), rowPx - 2);
    });
  }

  /* ---------------------------------------------------------------- hero strip: continuous batching on loop */
  (function hero() {
    var canvas = $('heroCanvas'); if (!canvas) return;
    var B = 6, seed = 11, sched, t = 0, last = 0, wait = 0, visible = true, raf = 0;
    function build() { sched = L.continuousSchedule(L.lengths(34, seed), B); t = 0; wait = 0; }
    function frame(ts) {
      raf = 0;
      var dt = last ? Math.min((ts - last) / 1000, 0.1) : 0; last = ts;
      if (t < sched.total) t += dt * 16; else { wait += dt; if (wait > 1.6) { seed += 1; build(); } }
      drawSchedule(canvas, sched, sched.total, t, 13);
      if (visible && !reduce) raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf && visible && !reduce) { last = 0; raf = requestAnimationFrame(frame); } }
    build();
    if (reduce) { t = sched.total; drawSchedule(canvas, sched, sched.total, t, 13); }
    else start();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); }).observe(canvas);
    }
    window.addEventListener('resize', function () { drawSchedule(canvas, sched, sched.total, t, 13); });
    window.__heroRedraw = function () { drawSchedule(canvas, sched, sched.total, t, 13); };
  })();

  /* ---------------------------------------------------------------- lab: tabs */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  function showTab(name) {
    tabs.forEach(function (b) {
      var on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      $('panel-' + b.dataset.tab).hidden = !on;
    });
    if (name === 'batch') batch.redraw();
    if (name === 'noise') noise.render();
    if (name === 'guard') guard.render();
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  /* ---------------------------------------------------------------- lab: batching */
  var batch = (function () {
    var cs = $('batchStatic'), cc = $('batchCont');
    var S = { seed: 3, B: 8, speed: 1, t: 0, playing: !reduce, last: 0, ss: null, cs: null, maxT: 1 };
    function rebuild() {
      var lens = L.lengths(40, S.seed);
      S.ss = L.staticSchedule(lens, S.B); S.cs = L.continuousSchedule(lens, S.B);
      S.maxT = S.ss.total; S.t = reduce ? S.maxT : 0;
      var gain = (1 - S.cs.total / S.ss.total) * 100;
      $('bStaticSteps').textContent = fmt(S.ss.total); $('bContSteps').textContent = fmt(S.cs.total);
      $('bStaticLat').textContent = fmt(S.ss.meanLatency, 1); $('bContLat').textContent = fmt(S.cs.meanLatency, 1);
      $('bGain').textContent = fmt(gain, 0) + '%';
      redraw(); sync();
    }
    function redraw() {
      if (!S.ss) return;
      drawSchedule(cs, S.ss, S.maxT, S.t, 14); drawSchedule(cc, S.cs, S.maxT, S.t, 14);
    }
    function sync() { $('bPlay').textContent = S.playing ? 'Pause' : (S.t >= S.maxT ? 'Replay' : 'Play'); }
    function frame(ts) {
      var dt = S.last ? Math.min((ts - S.last) / 1000, 0.1) : 0; S.last = ts;
      if (S.playing) {
        S.t = Math.min(S.maxT, S.t + dt * 10 * S.speed);
        if (S.t >= S.maxT) { S.playing = false; sync(); }
      }
      redraw();
      if (S.playing) requestAnimationFrame(frame); else S.last = 0;
    }
    function play() { if (S.t >= S.maxT) S.t = 0; S.playing = true; S.last = 0; sync(); requestAnimationFrame(frame); }
    $('bPlay').addEventListener('click', function () { if (S.playing) { S.playing = false; sync(); } else play(); });
    $('bNew').addEventListener('click', function () { S.seed += 1; rebuild(); if (!reduce) play(); });
    $('bSlots').addEventListener('input', function (e) { S.B = +e.target.value; $('bSlotsOut').textContent = S.B; rebuild(); if (!reduce) play(); });
    $('bSpeed').addEventListener('change', function (e) { S.speed = +e.target.value; });
    rebuild(); if (!reduce) play();
    return { redraw: function () { redraw(); } };
  })();

  /* ---------------------------------------------------------------- lab: KV cache */
  (function kv() {
    var CTX = [2048, 4096, 8192, 16384, 32768, 65536, 131072], TP = [1, 2, 4, 8];
    var mSel = $('kvModel'), gSel = $('kvGpu');
    Object.keys(L.SPECS).forEach(function (k) { var o = el('option', '', L.SPECS[k].name); o.value = k; mSel.appendChild(o); });
    Object.keys(L.GPUS).forEach(function (k) { var o = el('option', '', L.GPUS[k].name); o.value = k; gSel.appendChild(o); });
    mSel.value = 'llama3-8b'; gSel.value = 'a100';
    function run() {
      var spec = L.SPECS[mSel.value], gpu = L.GPUS[gSel.value];
      var tp = TP[+$('kvTp').value], ctx = CTX[+$('kvCtx').value];
      var wb = +$('kvW').value, kb = +$('kvK').value;
      $('kvTpOut').textContent = tp; $('kvCtxOut').textContent = fmt(ctx);
      var p = L.plan(spec, gpu.gb, tp, ctx, wb, kb);
      $('kvWeights').textContent = fmt(p.weights, 1) + ' GB';
      $('kvPool').textContent = fmt(p.pool, 1) + ' GB';
      $('kvConc').textContent = p.fits ? fmt(p.concurrent) : '0';
      $('kvTps').textContent = fmt(L.decodeTps(spec, gpu.bw, tp, wb, 1), 0) + ' tok/s';
      var total = p.weights + p.overhead + p.pool + p.reserve, scale = Math.max(total, gpu.gb);
      var segs = [['kvSegW', p.weights], ['kvSegO', p.overhead], ['kvSegK', p.pool], ['kvSegR', p.reserve]];
      segs.forEach(function (s) { $(s[0]).style.width = (s[1] / scale * 100) + '%'; });
      $('kvBar').style.borderColor = p.fits ? '' : css('--amber');
      var v = $('kvVerdict');
      v.className = 'verdict ' + (p.fits && p.concurrent >= 1 ? 'ok' : 'bad');
      if (!p.fits) v.textContent = 'Does not fit: the weights alone need ' + fmt(p.weights, 1) + ' GB per GPU. Add GPUs, lower the precision, or use a larger card.';
      else if (p.concurrent < 1) v.textContent = 'The weights fit, but one sequence this long does not. The cache holds about ' + fmt(p.maxTokens) + ' tokens.';
      else v.textContent = 'Fits. About ' + fmt(p.concurrent) + ' sequences of ' + fmt(ctx) + ' tokens at once (' + fmt(p.maxTokens) + ' cached tokens per GPU).';
    }
    ['kvModel', 'kvGpu', 'kvTp', 'kvCtx', 'kvW', 'kvK'].forEach(function (id) { $(id).addEventListener('input', run); });
    run();
  })();

  /* ---------------------------------------------------------------- lab: evaluation noise */
  var noise = (function () {
    var NS = [50, 100, 200, 400, 800, 1600, 3200], seed = 5;
    function render() {
      var p = +$('nAcc').value / 100, n = NS[+$('nN').value];
      $('nAccOut').textContent = fmt(p * 100) + '%'; $('nNOut').textContent = fmt(n);
      var r = L.evalNoise(p, n, seed);
      $('nObs').textContent = fmt(r.phat * 100, 1) + '%';
      $('nCI').textContent = fmt(r.lo * 100, 1) + ' to ' + fmt(r.hi * 100, 1);
      $('nHalf').textContent = '±' + fmt(r.halfWidth * 100, 1) + ' pts';
      var need = L.itemsFor(Math.min(0.99, Math.max(0.01, r.phat)), 0.02);
      $('nNeed').textContent = fmt(need);
      var v = $('nVerdict'), inside = r.halfWidth * 100 > 2;
      v.className = 'verdict ' + (inside ? 'bad' : 'ok');
      v.textContent = inside ? 'On this run, a 2-point gain sits inside the noise. A leaderboard difference this small would not tell you much.'
                             : 'On this run, a 2-point gain would stand clear of the noise.';
      hist(r);
    }
    function hist(r) {
      var svg = $('nHist'), W = 600, H = 150, bins = 32, m = r.means;
      var lo = m[0], hi = m[m.length - 1]; if (hi - lo < 1e-9) { lo -= 0.01; hi += 0.01; }
      var counts = new Array(bins).fill(0);
      m.forEach(function (v) { counts[Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins))]++; });
      var top = Math.max.apply(null, counts), x = function (v) { return (v - lo) / (hi - lo) * W; };
      var out = '<rect x="' + x(r.lo) + '" y="0" width="' + Math.max(x(r.hi) - x(r.lo), 1) + '" height="' + (H - 18) + '" style="fill:var(--accent-soft)"/>';
      counts.forEach(function (c, i) {
        var h = c / top * (H - 22), bw = W / bins;
        out += '<rect x="' + (i * bw + 1) + '" y="' + (H - 18 - h) + '" width="' + (bw - 2) + '" height="' + h + '" style="fill:var(--seg0)"/>';
      });
      out += '<line x1="' + x(r.phat) + '" x2="' + x(r.phat) + '" y1="0" y2="' + (H - 18) + '" style="stroke:var(--ink)" stroke-width="1.5"/>';
      out += '<text x="2" y="' + (H - 3) + '" style="fill:var(--muted)" font-size="11">' + fmt(lo * 100, 1) + '%</text>';
      out += '<text x="' + (W - 2) + '" y="' + (H - 3) + '" text-anchor="end" style="fill:var(--muted)" font-size="11">' + fmt(hi * 100, 1) + '%</text>';
      svg.innerHTML = out;
    }
    ['nAcc', 'nN'].forEach(function (id) { $(id).addEventListener('input', render); });
    $('nAgain').addEventListener('click', function () { seed += 1; render(); });
    render();
    return { render: render };
  })();


  /* ---------------------------------------------------------------- lab: guardrails */
  var guard = (function () {
    var BASE = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2];
    function curve(d, mu, xmin, xmax) {
      var pts = [], N = 120;
      for (var i = 0; i <= N; i++) { var x = xmin + (xmax - xmin) * i / N; pts.push([x, Math.exp(-0.5 * (x - mu) * (x - mu)) / Math.sqrt(2 * Math.PI)]); }
      return pts;
    }
    function render() {
      var d = +$('gD').value / 10, t = +$('gT').value / 10, b = BASE[+$('gB').value];
      $('gDOut').textContent = d.toFixed(1); $('gTOut').textContent = t.toFixed(1); $('gBOut').textContent = (b * 100) + '%';
      var r = L.guardrail(d, t, b, 10000);
      $('gFlag').textContent = fmt(r.flagged); $('gFalse').textContent = fmt(r.falseAlarms); $('gMissed').textContent = fmt(r.missed);
      $('gPrec').textContent = fmt(r.precision * 100, 0) + '%'; $('gRecall').textContent = fmt(r.tpr * 100, 0) + '%';
      var v = $('gVerdict'), mostlyFalse = r.precision < 0.5 && r.flagged > 0;
      v.className = 'verdict ' + (mostlyFalse ? 'bad' : 'ok');
      v.textContent = mostlyFalse
        ? 'Most alerts are false: only ' + fmt(r.precision * 100, 0) + '% of flagged requests are really unsafe, and it still misses ' + fmt(r.missed) + ' of ' + fmt(r.unsafe) + '.'
        : 'Most alerts are real (' + fmt(r.precision * 100, 0) + '%), and it misses ' + fmt(r.missed) + ' of ' + fmt(r.unsafe) + ' unsafe requests.';
      var xmin = -3.2, xmax = d + 3.2, W = 600, H = 150, base = H - 18, sx = function (x) { return (x - xmin) / (xmax - xmin) * W; }, sy = function (y) { return base - y / 0.42 * (base - 6); };
      var safe = curve(d, 0, xmin, xmax), uns = curve(d, d, xmin, xmax);
      var path = function (pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join(' '); };
      var area = function (pts, keep) {
        var sel = pts.filter(function (p) { return keep(p[0]); }); if (!sel.length) return '';
        return 'M' + sx(sel[0][0]).toFixed(1) + ' ' + base + ' ' + sel.map(function (p) { return 'L' + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join(' ') + ' L' + sx(sel[sel.length - 1][0]).toFixed(1) + ' ' + base + ' Z';
      };
      var out = '<path d="' + area(safe, function (x) { return x >= t; }) + '" style="fill:var(--amber)" opacity="0.55"/>'
              + '<path d="' + area(uns, function (x) { return x <= t; }) + '" style="fill:var(--ink)" opacity="0.35"/>'
              + '<path d="' + path(safe) + '" fill="none" style="stroke:var(--seg3)" stroke-width="2"/>'
              + '<path d="' + path(uns) + '" fill="none" style="stroke:var(--seg0)" stroke-width="2"/>'
              + '<line x1="' + sx(t) + '" x2="' + sx(t) + '" y1="2" y2="' + base + '" style="stroke:var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/>'
              + '<text x="' + Math.min(sx(t) + 4, W - 70) + '" y="12" style="fill:var(--muted)" font-size="11">flag above</text>'
              + '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" style="stroke:var(--line)"/>'
              + '<text x="2" y="' + (H - 3) + '" style="fill:var(--muted)" font-size="11">low score</text>'
              + '<text x="' + (W - 2) + '" y="' + (H - 3) + '" text-anchor="end" style="fill:var(--muted)" font-size="11">high score</text>';
      $('gChart').innerHTML = out;
    }
    ['gD', 'gT', 'gB'].forEach(function (id) { $(id).addEventListener('input', render); });
    render();
    return { render: render };
  })();

  /* ---------------------------------------------------------------- work */
  (function work() {
    var list = DATA.projects, grid = $('workGrid'), chips = $('workChips');
    var STATUS = { production: 'Commercial', shipped: 'Open research', progress: 'In progress' };
    var filters = [['all', 'All']].concat(['production', 'shipped', 'progress'].filter(function (s) { return list.some(function (p) { return p.status === s; }); }).map(function (s) { return [s, STATUS[s]]; }));
    var tags = []; list.forEach(function (p) { p.tags.forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); }); });
    tags.forEach(function (t) { filters.push([t, t]); });
    var cur = 'all';
    function render() {
      grid.textContent = '';
      var shown = list.filter(function (p) { return cur === 'all' || p.status === cur || p.tags.indexOf(cur) >= 0; });
      shown.forEach(function (p) {
        var c = el('article', 'card');
        c.appendChild(el('span', 'badge ' + p.status, STATUS[p.status]));
        c.appendChild(el('h3', '', p.title));
        c.appendChild(el('p', 'mono muted ctxline', p.context));
        c.appendChild(el('p', '', p.summary));
        var tg = el('div', 'tags'); p.tags.forEach(function (t) { tg.appendChild(el('span', '', t)); }); c.appendChild(tg);
        var d = el('details'); d.appendChild(el('summary', '', 'What is real here')); d.appendChild(el('p', '', p.detail)); c.appendChild(d);
        if (p.links.length) {
          var l = el('div', 'links');
          p.links.forEach(function (k, i) { if (i) l.appendChild(document.createTextNode(' · ')); var a = el('a', '', k.label); a.href = k.href; a.rel = 'noopener'; a.target = '_blank'; l.appendChild(a); });
          c.appendChild(l);
        }
        grid.appendChild(c);
      });
      if (!shown.length) grid.appendChild(el('p', 'empty', 'Nothing here yet.'));
      Array.prototype.forEach.call(chips.children, function (b) { b.setAttribute('aria-pressed', b.dataset.f === cur ? 'true' : 'false'); });
    }
    filters.forEach(function (f) {
      var b = el('button', 'chip', f[1]); b.type = 'button'; b.dataset.f = f[0];
      b.addEventListener('click', function () { cur = f[0]; render(); }); chips.appendChild(b);
    });
    render();
  })();

  /* ---------------------------------------------------------------- research */
  (function research() {
    var ul = $('papers');
    DATA.papers.forEach(function (p) {
      var li = el('li'); var t = p.href ? el('a', '', p.title) : el('span', '', p.title);
      if (p.href) { t.href = p.href; t.target = '_blank'; t.rel = 'noopener'; }
      li.appendChild(t); li.appendChild(el('div', 'v', p.venue + ', ' + p.year)); ul.appendChild(li);
    });
  })();

  /* deep links: #batch, #kv, #noise open that lab tab */
  function fromHash() {
    var h = location.hash.slice(1);
    if (['batch', 'kv', 'noise', 'guard'].indexOf(h) >= 0) { showTab(h); $('lab').scrollIntoView(); }
  }
  window.addEventListener('hashchange', fromHash); fromHash();

  /* redraw canvases when the system theme flips */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var again = function () { hatchCache = {}; batch.redraw(); if (window.__heroRedraw) window.__heroRedraw(); };
    if (mq.addEventListener) mq.addEventListener('change', again);
  }
  window.addEventListener('resize', function () { batch.redraw(); });
})();

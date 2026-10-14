/* ==========================================================================
   visual.js — visualizzazione rallentata della moltiplicazione scalare (canvas).

   Ogni operazione P + Q viene mostrata in quattro fasi, sulla griglia F_p × F_p:
     1. si evidenziano i due operandi P e Q;
     2. si traccia la "retta" per P e Q (la tangente se P = Q). Modulo p la retta
        y = λ(x − x₁) + y₁ si avvolge sul quadrato come su un toro: i suoi p punti
        interi sono i pallini arancioni;
     3. la retta incontra la curva in un terzo punto −R;
     4. il risultato è il simmetrico R = (x₃, y₃): riflessione y → p − y.
   ========================================================================== */
(function () {
  'use strict';
  const { pointAdd, scalarMult, fmt, mod, INF, allPoints } = window.ECC;
  const $ = id => document.getElementById(id);

  const cv = $('viz-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const ui = {
    mode: $('viz-mode'), play: $('viz-play'), step: $('viz-step'), reset: $('viz-reset'),
    speed: $('viz-speed'), speedOut: $('viz-speed-out'), info: $('viz-info'), phase: $('viz-phase'), note: $('viz-note')
  };
  const MAX_P = 101;
  const MAX_STEPS = 400;
  const BASE_MS = 3200;

  let S = null;         // scena corrente
  let colors = {};
  let raf = 0, lastTs = 0;

  const sub = s => String(s).replace(/[0-9]/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);
  const key = P => P === INF ? 'O' : P.x + ',' + P.y;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    colors = {
      bg: g('--bg'), surface: g('--surface'), text: g('--text'), text2: g('--text-2'), muted: g('--muted'),
      grid: g('--grid'), axis: g('--axis'), s1: g('--series-1'), s2: g('--series-2'), s3: g('--series-3')
    };
  }

  /* ----------------------------- costruzione ------------------------------ */
  function build() {
    const st = window.HW1;
    if (!st || !st.C) return;
    stop();
    const { C, G, k, n } = st;
    if (C.p > MAX_P) {
      S = null;
      ui.note.textContent = `Con p = ${C.p} la griglia sarebbe troppo fitta: per l'animazione scegli p ≤ ${MAX_P}.`;
      resize();
      return;
    }
    const pts = allPoints(C);
    const dlog = new Map();            // punto → indice i tale che punto = iG
    let R = G;
    for (let i = 1; i < n; i++) { dlog.set(key(R), i); R = pointAdd(C, R, G); }

    const steps = [];
    const mode = ui.mode.value;
    if (mode === 'naive') {
      let acc = G;
      const kk = Math.min(k, MAX_STEPS + 1);
      for (let i = 2; i <= kk; i++) {
        const info = {};
        const R2 = pointAdd(C, acc, G, info);
        steps.push({ P: acc, Q: G, R: R2, info, op: info.kind === 'double' ? 'double' : 'add', title: `${i}G = ${i - 1}G + G`, acc: i });
        acc = R2;
      }
      ui.note.textContent = k > MAX_STEPS + 1 ? `k è grande: mostro solo i primi ${MAX_STEPS} passi (usa double-and-add).` : '';
    } else {
      scalarMult(C, k, G, s => {
        if (s.op === 'start') return;
        steps.push({
          P: s.before, Q: s.op === 'double' ? s.before : G, R: s.after, info: s.info, op: s.op,
          bitIndex: s.bitIndex, title: s.op === 'double' ? `R ← 2R  (= ${s.acc}G)` : `R ← R + G  (= ${s.acc}G)`, acc: s.acc
        });
      });
      ui.note.textContent = '';
    }
    S = { C, G, k, n, pts, dlog, steps, mode, idx: 0, t: 0, playing: false, single: false, bits: k.toString(2) };
    resize();
    updateInfo();
    updateButtons();
  }

  /* ------------------------------ geometria ------------------------------- */
  let W = 0, H = 0, dpr = 1, geo = null;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S) {
      const m = { l: 30, r: 10, t: 10, b: 26 };
      const size = Math.min(W - m.l - m.r, H - m.t - m.b);
      const cell = size / S.C.p;
      geo = { m, cell, size, ox: m.l, oy: m.t + size };
    }
    draw();
  }
  const X = x => geo.ox + (x + 0.5) * geo.cell;
  const Y = y => geo.oy - (y + 0.5) * geo.cell;

  /* -------------------------------- disegno ------------------------------- */
  function dot(x, y, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(X(x), Y(y), r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function label(str, x, y, color, dx = 0, dy = 0, size = 11, weight = 600) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(str, X(x) + dx, Y(y) + dy);
  }
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!S || !geo) {
      ctx.fillStyle = colors.muted;
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nessuna griglia da mostrare', W / 2, H / 2);
      ctx.textAlign = 'start';
      return;
    }
    const { C, pts, dlog } = S;
    const p = C.p;
    const cell = geo.cell;
    const r = Math.max(2.5, Math.min(7, cell * 0.26));

    // griglia
    const every = p <= 23 ? 1 : p <= 50 ? 5 : 10;
    ctx.lineWidth = 1;
    for (let i = 0; i < p; i++) {
      const major = i % every === 0;
      if (p <= 43 || major) {
        ctx.strokeStyle = colors.grid;
        ctx.globalAlpha = major ? 1 : 0.6;
        ctx.beginPath(); ctx.moveTo(X(i), Y(0) + cell / 2); ctx.lineTo(X(i), Y(p - 1) - cell / 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(0) - cell / 2, Y(i)); ctx.lineTo(X(p - 1) + cell / 2, Y(i)); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (major) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = colors.muted;
        ctx.textAlign = 'center';
        ctx.fillText(String(i), X(i), geo.oy + 15);
        ctx.textAlign = 'right';
        ctx.fillText(String(i), geo.ox - 6, Y(i) + 3.5);
        ctx.textAlign = 'start';
      }
    }
    ctx.strokeStyle = colors.axis;
    ctx.strokeRect(geo.ox, geo.oy - geo.size, geo.size, geo.size);

    // tutti i punti della curva (vuoti) e quelli del sottogruppo <G> (pieni)
    pts.forEach(P => {
      if (dlog.has(key(P))) dot(P.x, P.y, r * 0.75, colors.muted);
      else dot(P.x, P.y, r * 0.7, null, colors.muted, 1.2);
    });
    if (p <= 43) {
      pts.forEach(P => {
        const i = dlog.get(key(P));
        if (i) label(i === 1 ? 'G' : i + 'G', P.x, P.y, colors.text2, r + 2, -r - 1, 10, 500);
      });
    }

    // scia dei multipli già calcolati
    const done = S.steps.slice(0, S.idx);
    ctx.strokeStyle = colors.s1; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
    let prev = S.G;
    done.forEach(st => {
      if (prev !== INF && st.R !== INF) {
        ctx.beginPath(); ctx.moveTo(X(prev.x), Y(prev.y)); ctx.lineTo(X(st.R.x), Y(st.R.y)); ctx.stroke();
      }
      prev = st.R;
    });
    ctx.globalAlpha = 1;

    const acc = S.idx === 0 ? S.G : S.steps[S.idx - 1].R;
    const cur = S.steps[S.idx];

    if (!cur || S.t === 0) {
      // stato fermo: evidenzia l'accumulatore R
      if (acc !== INF) {
        dot(acc.x, acc.y, r + 3, colors.s1, colors.surface, 2);
        label('R', acc.x, acc.y, colors.text, -r - 16, r + 14, 12, 700);
      }
      if (!cur) setPhase(S.steps.length ? `Fine: Q = ${S.k}G = ${fmt(acc)} è la TOY PUBLIC KEY.` : `k = 1: Q = G = ${fmt(acc)}.`);
      else setPhase('Pronto: premi ▶ Avvia oppure Passo.');
      return;
    }

    // ---- animazione del passo corrente ----
    const t = S.t;
    const { P, Q, R, info } = cur;
    const a1 = seg(t, 0, 0.14), a2 = seg(t, 0.14, 0.55), a3 = seg(t, 0.55, 0.68), a4 = seg(t, 0.68, 0.9), a5 = seg(t, 0.9, 1);

    // fase 1: operandi
    if (P !== INF) dot(P.x, P.y, r + 3, colors.s1, colors.surface, 2);
    if (Q !== INF && !(P !== INF && P.x === Q.x && P.y === Q.y)) dot(Q.x, Q.y, r + 3, colors.s3, colors.surface, 2);
    const pulse = 1 + 0.6 * Math.sin(a1 * Math.PI);
    if (P !== INF) dot(P.x, P.y, (r + 7) * pulse, null, colors.s1, 2);
    if (Q !== INF) dot(Q.x, Q.y, (r + 7) * pulse, null, colors.s3, 2);
    if (P !== INF) label(info.kind === 'double' ? 'P = Q' : 'P', P.x, P.y, colors.text, -r - 30, -r - 6, 12, 700);
    if (Q !== INF && info.kind !== 'double') label('Q', Q.x, Q.y, colors.text, -r - 14, -r - 6, 12, 700);

    if (info.kind === 'identity') {
      setPhase('O + G = G: il punto all\'infinito è l\'elemento neutro.');
      if (a4 > 0 && R !== INF) dot(R.x, R.y, r + 3, colors.s1, colors.surface, 2);
      return;
    }

    if (info.kind === 'inverse') {
      // retta verticale: P + (−P) = O
      if (a2 > 0) {
        ctx.strokeStyle = colors.s2; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
        const top = Y(0) + cell / 2 - (Y(0) - Y(p - 1) + cell) * ease(a2);
        ctx.beginPath(); ctx.moveTo(X(P.x), Y(0) + cell / 2); ctx.lineTo(X(P.x), top); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      setPhase(t < 0.55 ? 'Q = −P: la retta per P e Q è verticale…' : '…e non incontra un terzo punto: P + Q = O (punto all\'infinito).');
      return;
    }

    // fase 2: retta (che si avvolge modulo p) e i suoi p punti interi
    const lam = info.lambda;
    const slope = lam <= p / 2 ? lam : lam - p;
    const xs = -0.5 + p * ease(a2);
    if (a2 > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(geo.ox, geo.oy - geo.size, geo.size, geo.size);
      ctx.clip();
      ctx.strokeStyle = colors.s2; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5;
      ctx.beginPath();
      const N = 60 * p;
      let prevY = null;
      for (let i = 0; i <= N; i++) {
        const x = -0.5 + (p * i) / N;
        if (x > xs) break;
        const y = slope * (x - P.x) + P.y;
        const ym = mod(y + 0.5, p) - 0.5;
        if (prevY === null || Math.abs(ym - prevY) > p / 2) ctx.moveTo(X(x), Y(ym));
        else ctx.lineTo(X(x), Y(ym));
        prevY = ym;
      }
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      for (let x = 0; x < p && x <= xs; x++) {
        const y = mod(lam * (x - P.x) + P.y, p);
        dot(x, y, Math.max(2, r * 0.45), colors.s2);
      }
    }

    // fase 3: terza intersezione −R
    const third = info.third;
    if (a3 > 0) {
      dot(third.x, third.y, (r + 3) * (0.6 + 0.4 * a3), colors.s2, colors.surface, 2);
      label('−R', third.x, third.y, colors.text, r + 5, r + 12, 12, 700);
    }
    // fase 4: riflessione y → p − y (asse di simmetria y = p/2)
    if (a4 > 0) {
      const ymid = (p - 1) / 2;
      ctx.setLineDash([4, 4]); ctx.strokeStyle = colors.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(geo.ox, Y(ymid + 0.0) - 0); ctx.lineTo(geo.ox + geo.size, Y(ymid)); ctx.stroke();
      ctx.setLineDash([]);
      const y0 = third.y, y1 = R.y;
      const yc = y0 + (y1 - y0) * ease(a4);
      ctx.strokeStyle = colors.text; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(third.x), Y(y0)); ctx.lineTo(X(third.x), Y(yc)); ctx.stroke();
      const dir = y1 > y0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(X(third.x), Y(yc));
      ctx.lineTo(X(third.x) - 5, Y(yc) + dir * 8);
      ctx.lineTo(X(third.x) + 5, Y(yc) + dir * 8);
      ctx.closePath(); ctx.fillStyle = colors.text; ctx.fill();
    }
    if (a5 > 0) {
      dot(R.x, R.y, r + 3 + 3 * (1 - a5), colors.s1, colors.surface, 2);
      label('R', R.x, R.y, colors.text, -r - 16, r + 14, 12, 700);
    }

    if (t < 0.14) setPhase('1 · Operandi: ' + (info.kind === 'double' ? `raddoppio di P = ${fmt(P)}` : `P = ${fmt(P)} e Q = ${fmt(Q)}`));
    else if (t < 0.55) setPhase(`2 · ${info.kind === 'double' ? 'Tangente' : 'Retta'} con pendenza λ = ${lam}: modulo ${p} si "avvolge" sulla griglia (punti arancioni).`);
    else if (t < 0.68) setPhase(`3 · La retta incontra la curva in un terzo punto −R = ${fmt(third)}.`);
    else setPhase(`4 · Riflessione rispetto a y = ${p}/2: R = (${third.x}, ${p} − ${third.y}) = ${fmt(R)}.`);
  }

  function setPhase(s) { if (ui.phase.textContent !== s) ui.phase.textContent = s; }

  /* --------------------------- pannello laterale -------------------------- */
  function updateInfo() {
    if (!S) { ui.info.innerHTML = ''; return; }
    const total = S.steps.length;
    const cur = S.steps[S.idx];
    const bitsHtml = S.mode === 'dbl'
      ? `<div class="small muted">k = ${S.k} = ${S.bits}${sub(2)} (bit corrente evidenziato)</div><div class="bits">` +
        S.bits.split('').map((b, i) => {
          const curBit = cur ? cur.bitIndex : S.bits.length;
          return `<span class="${i === curBit ? 'cur' : i < curBit ? 'done' : ''}">${b}</span>`;
        }).join('') + '</div>'
      : '';

    if (!cur) {
      const acc = S.idx === 0 ? S.G : S.steps[S.idx - 1].R;
      ui.info.innerHTML = `<div class="step-title">Completato: ${total} operazioni</div>${bitsHtml}
        <div class="formula">TOY PUBLIC KEY
Q = ${S.k}·G = ${fmt(acc)}</div>`;
      return;
    }
    const { P, Q, R, info } = cur;
    const nm = i => (i === undefined ? '' : i === 1 ? '  (G)' : `  (${i}G)`);
    let f = `P = ${fmt(P)}${nm(S.dlog.get(key(P)))}\nQ = ${fmt(Q)}${nm(S.dlog.get(key(Q)))}\n`;
    if (info.kind === 'double' || info.kind === 'add') {
      const x1 = P.x, y1 = P.y, x2 = Q.x, l = info.lambda;
      f += info.kind === 'double'
        ? `λ = (3·x₁²)/(2·y₁) = ${info.num}·${info.den}⁻¹\n  = ${info.num}·${info.inv} ≡ ${l}  (mod ${S.C.p})\n`
        : `λ = (y₂ − y₁)/(x₂ − x₁) = ${info.num}·${info.den}⁻¹\n  = ${info.num}·${info.inv} ≡ ${l}  (mod ${S.C.p})\n`;
      f += `x₃ = λ² − x₁ − x₂ = ${l * l - x1 - x2} ≡ ${info.x3}\n`;
      f += `y₃ = λ(x₁ − x₃) − y₁ = ${l * (x1 - info.x3) - y1} ≡ ${info.y3}\n`;
      f += `−R = (x₃, −y₃) = ${fmt(info.third)}\n R = ${fmt(R)}${nm(S.dlog.get(key(R)))}`;
    } else if (info.kind === 'inverse') {
      f += `Q = −P  ⇒  P + Q = O`;
    } else {
      f += `O + G = G`;
    }
    const opName = cur.op === 'double' ? 'Raddoppio' : 'Addizione';
    ui.info.innerHTML = `<div class="step-title">Passo ${S.idx + 1} di ${total} · ${opName}</div>
      <div class="small muted" style="margin-bottom:6px">${cur.title}</div>${bitsHtml}<div class="formula">${f}</div>`;
  }

  function updateButtons() {
    const has = S && S.idx < S.steps.length;
    ui.play.disabled = !has;
    ui.step.disabled = !has || S.playing;
    ui.play.textContent = S && S.playing ? '❚❚ Pausa' : '▶ Avvia';
  }

  /* ------------------------------ animazione ------------------------------ */
  function speed() { return parseFloat(ui.speed.value); }
  function tick(ts) {
    if (!S) return;
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;
    S.t += dt / (BASE_MS / speed());
    if (S.t >= 1) {
      S.t = 0;
      S.idx++;
      updateInfo();
      if (S.single || S.idx >= S.steps.length) {
        S.playing = false; S.single = false;
        draw(); updateButtons();
        raf = 0;
        return;
      }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }
  function start(single) {
    if (!S || S.idx >= S.steps.length) return;
    S.playing = !single;
    S.single = !!single;
    lastTs = 0;
    if (!raf) raf = requestAnimationFrame(tick);
    updateButtons();
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (S) { S.playing = false; S.single = false; }
  }

  ui.play.addEventListener('click', () => {
    if (S && S.playing) { stop(); updateButtons(); }
    else start(false);
  });
  ui.step.addEventListener('click', () => start(true));
  ui.reset.addEventListener('click', () => { build(); });
  ui.mode.addEventListener('change', build);
  ui.speed.addEventListener('input', () => { ui.speedOut.textContent = speed() + '×'; });
  document.addEventListener('hw1-config', build);
  document.addEventListener('themechange', () => { readColors(); draw(); });
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(cv);
  else window.addEventListener('resize', resize);

  readColors();
  ui.speedOut.textContent = speed() + '×';
  build();
})();

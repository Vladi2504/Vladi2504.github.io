/* ==========================================================================
   stats.js — esplorazione statistica dei punti Q = kG.

   Per una curva e un punto base G si genera un campione di chiavi k
   (tutte le k = 1 … n−1, oppure N chiavi casuali) e si studiano le
   coordinate dei punti ottenuti: distribuzione, frequenze, bit,
   correlazioni con l'input ed effetto valanga (confrontato con SHA-256).
   ========================================================================== */
(function () {
  'use strict';
  const E = window.ECC;
  const { Charts } = window;
  const $ = id => document.getElementById(id);
  const nf = (v, d = 2) => Number(v).toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const nfx = (v, d) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : Number(v)).toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (v, d = 1) => nfx(100 * v, d) + '%';

  const PRESETS = {
    p17: { p: 17, b: 7, G: { x: 1, y: 5 }, label: 'p = 17, G = (1, 5) — la curva della traccia' },
    p97: { p: 97, b: 7, label: 'p = 97 (#E = 79, primo)' },
    p1051: { p: 1051, b: 7, label: 'p = 1051 (#E = 1093, primo, 11 bit)' },
    p65419: { p: 65419, b: 7, label: 'p = 65419 (#E = 64921, primo, 16 bit)' },
    program: { label: 'Curva, G e parametri del programma (sezione 3)' }
  };

  const ui = {
    preset: $('st-preset'), mode: $('st-mode'), N: $('st-N'), run: $('st-run'), newG: $('st-newG'),
    status: $('st-status'), results: $('st-results')
  };

  /* ------------------------------ utilità --------------------------------- */
  function randInt(lo, hi) {             // intero uniforme in [lo, hi], senza bias
    const range = hi - lo + 1;
    const lim = Math.floor(0x100000000 / range) * range;
    const buf = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < lim) return lo + (buf[0] % range);
    }
  }
  const bitLength = v => (v <= 0 ? 0 : Math.floor(Math.log2(v)) + 1);
  function popcount(v) { let c = 0; while (v) { v &= v - 1; c++; } return c; }

  function mean(a) { let s = 0; for (const v of a) s += v; return s / a.length; }
  function pearson(a, b) {
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) {
      const da = a[i] - ma, db = b[i] - mb;
      sab += da * db; saa += da * da; sbb += db * db;
    }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  function ranks(a) {
    const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let t = i; t <= j; t++) r[idx[t]] = avg;
      i = j + 1;
    }
    return r;
  }
  const spearman = (a, b) => pearson(ranks(a), ranks(b));

  // Funzione Gamma incompleta regolarizzata Q(a, x) → p-value del test χ².
  function lnGamma(z) {
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = c[0];
    for (let i = 1; i < 9; i++) x += c[i] / (z + i);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function gammaQ(a, x) {
    if (x <= 0) return 1;
    const lead = Math.exp(-x + a * Math.log(x) - lnGamma(a));
    if (x < a + 1) {
      let sum = 1 / a, del = sum, ap = a;
      for (let n = 0; n < 1000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
      return Math.max(0, 1 - sum * lead);
    }
    const tiny = 1e-300;
    let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return lead * h;
  }
  const chi2p = (chi2, df) => (df > 0 ? gammaQ(df / 2, chi2 / 2) : 1);
  const fmtP = v => (v < 1e-4 ? '< 0,0001' : nfx(v, 4));

  function firstPoint(C) {
    for (let x = 1; x < C.p; x++) {
      const rhs = E.mod(E.mod(E.mod(x * x, C.p) * x, C.p) + C.b, C.p);
      for (let y = 1; y < C.p; y++) if (E.mod(y * y, C.p) === rhs) return { x, y: Math.min(y, C.p - y) };
    }
    return null;
  }
  function randomPoint(C, n) {
    // un multiplo casuale di un generatore: se l'ordine del gruppo è primo, ogni punto ≠ O genera tutto
    const g = firstPoint(C);
    let P;
    do { P = E.scalarMult(C, randInt(1, n - 1), g); } while (P === E.INF);
    return P;
  }

  /* ---------------------------- stato curva ------------------------------- */
  let cur = null; // { C, G, n, N, sub (punti di <G>), xMult }

  function setupCurve(keepG) {
    const id = ui.preset.value;
    let C, G;
    if (id === 'program') {
      const st = window.HW1;
      if (!st || !st.C) throw new Error('configura prima il programma nella sezione 3');
      C = st.C; G = st.G;
    } else {
      const pr = PRESETS[id];
      C = E.makeCurve(pr.p, 0, pr.b);
      G = keepG && cur && cur.C.p === C.p ? cur.G : (pr.G || firstPoint(C));
    }
    const Npts = E.countPoints(C);
    const n = E.pointOrder(C, G, Npts + 1);
    if (n > 300000) throw new Error('ordine di G troppo grande per questa pagina');
    // tutti i punti di <G> \ {O}: sub[i] = (i+1)·G
    const sub = [];
    let R = G;
    for (let i = 1; i < n; i++) { sub.push(R); R = E.pointAdd(C, R, G); }
    const xMult = new Map();
    sub.forEach(P => xMult.set(P.x, (xMult.get(P.x) || 0) + 1));
    cur = { C, G, n, N: Npts, sub, xMult };
    $('st-G-out').textContent = `G = ${E.fmt(G)}, ord(G) = ${n}`;
    ui.newG.disabled = id === 'program' || id === 'p17';
  }

  /* ---------------------------- esperimento ------------------------------- */
  function sample() {
    const { C, G, n, sub } = cur;
    const mode = ui.mode.value;
    let ks, pts;
    if (mode === 'all') {
      ks = sub.map((_, i) => i + 1);
      pts = sub;
    } else {
      const N = Math.max(10, Math.min(200000, parseInt(ui.N.value, 10) || 5000));
      ks = []; pts = [];
      for (let i = 0; i < N; i++) {
        const k = randInt(1, n - 1);
        ks.push(k); pts.push(sub[k - 1]);  // sub[k−1] = kG (tabella precalcolata, identica a scalarMult)
      }
    }
    return { ks, xs: pts.map(P => P.x), ys: pts.map(P => P.y), pts, mode };
  }

  function binsFor(p) {
    const B = Math.min(p, 32);
    const edges = [];
    for (let i = 0; i <= B; i++) edges.push(Math.floor((i * p) / B));
    return edges;
  }
  function binIndex(v, edges) {
    let lo = 0, hi = edges.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (edges[mid] <= v) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  const binLabel = (edges, i) => (edges[i + 1] - edges[i] === 1 ? String(edges[i]) : `${edges[i]}–${edges[i + 1] - 1}`);

  function chiSquare(obs, exp) {
    let chi = 0, df = -1;
    for (let i = 0; i < obs.length; i++) {
      if (exp[i] > 0) { chi += (obs[i] - exp[i]) ** 2 / exp[i]; df++; }
    }
    return { chi, df, pv: chi2p(chi, df) };
  }

  function run() {
    ui.status.textContent = 'Calcolo in corso…';
    ui.run.disabled = true;
    setTimeout(() => {
      try {
        setupCurve(true);
        const S = sample();
        render(S);
        ui.results.hidden = false;
        ui.status.textContent = '';
      } catch (e) {
        ui.status.textContent = 'Errore: ' + e.message;
      }
      ui.run.disabled = false;
    }, 20);
  }

  /* ------------------------------ rendering ------------------------------- */
  function render(S) {
    const { C, G, n, N: Npts, sub, xMult } = cur;
    const p = C.p;
    const m = bitLength(p - 1);
    const Ns = S.ks.length;
    const full = S.mode === 'all';
    const distinctPts = new Set(S.pts.map(P => P.x * p + P.y)).size;

    // --- riquadri riassuntivi
    const tiles = [
      ['Primo p', nf(p), `${m} bit per coordinata`],
      ['Punti sulla curva', nf(Npts), '#E(F_p), incluso O'],
      ['Ordine di G', nf(n), n === Npts ? 'G genera tutta la curva' : `cofattore ${Npts / n}`],
      ['Campioni', nf(Ns), full ? 'k = 1 … n − 1' : 'k casuali uniformi'],
      ['Punti distinti', nf(distinctPts), `su ${nf(n - 1)} possibili`]
    ];
    $('st-tiles').innerHTML = tiles.map(([l, v, s]) =>
      `<div class="tile"><div class="t-label">${l}</div><div class="t-value">${v}</div><div class="t-sub">${s}</div></div>`).join('');

    // --- 1. distribuzione di x e y
    const edges = binsFor(p);
    const B = edges.length - 1;
    const ranges = [...Array(B)].map((_, i) => binLabel(edges, i));
    const cats = edges.slice(0, B);   // etichetta = inizio della classe; l'intervallo completo è nel tooltip
    const hist = vals => { const h = new Array(B).fill(0); vals.forEach(v => h[binIndex(v, edges)]++); return h; };
    const hx = hist(S.xs), hy = hist(S.ys);
    const expUnif = [...Array(B)].map((_, i) => (Ns * (edges[i + 1] - edges[i])) / p);
    const expSubX = new Array(B).fill(0);
    xMult.forEach((c, x) => { expSubX[binIndex(x, edges)] += (Ns * c) / (n - 1); });
    const yMult = new Map();
    sub.forEach(P => yMult.set(P.y, (yMult.get(P.y) || 0) + 1));
    const expSubY = new Array(B).fill(0);
    yMult.forEach((c, y) => { expSubY[binIndex(y, edges)] += (Ns * c) / (n - 1); });

    const tipHist = (h, exp) => i => `<b>${C.p <= 32 ? 'valore' : 'intervallo'} ${ranges[i]}</b><br>osservati: ${nf(h[i])}<br>attesi (uniforme su F_p): ${nf(exp[i], 1)}`;
    Charts.bars('#st-x-chart', {
      categories: cats, series: [{ name: 'x', color: 'var(--series-1)', values: hx }], expected: expUnif,
      xLabel: 'coordinata x', yLabel: 'frequenza', tooltip: tipHist(hx, expUnif), height: 210
    });
    Charts.bars('#st-y-chart', {
      categories: cats, series: [{ name: 'y', color: 'var(--series-3)', values: hy }], expected: expUnif,
      xLabel: 'coordinata y', yLabel: 'frequenza', tooltip: tipHist(hy, expUnif), height: 210
    });

    const cxU = chiSquare(hx, expUnif), cxS = chiSquare(hx, expSubX);
    const cyU = chiSquare(hy, expUnif), cyS = chiSquare(hy, expSubY);
    $('st-chi-table').innerHTML = `
      <table><thead><tr><th>Test χ² (${B} classi)</th><th class="num">χ² su x</th><th class="num">p-value</th><th class="num">χ² su y</th><th class="num">p-value</th></tr></thead>
      <tbody>
        <tr><td>H₀: coordinate uniformi su F<sub>p</sub> = {0,…,${p - 1}}</td><td class="num">${nf(cxU.chi)}</td><td class="num">${fmtP(cxU.pv)}</td><td class="num">${nf(cyU.chi)}</td><td class="num">${fmtP(cyU.pv)}</td></tr>
        <tr><td>H₀: punto uniforme su ⟨G⟩ (quindi x, y con le molteplicità reali)</td><td class="num">${nf(cxS.chi)}</td><td class="num">${fmtP(cxS.pv)}</td><td class="num">${nf(cyS.chi)}</td><td class="num">${fmtP(cyS.pv)}</td></tr>
      </tbody></table>`;

    const validX = xMult.size;
    const yCounts = new Set(yMult.values());
    const yTriples = p % 3 === 1 && yCounts.has(3) && [...yCounts].every(c => c === 3 || c === 1);
    const evenY = S.ys.filter(y => y % 2 === 0).length / Ns;
    const lowY = S.ys.filter(y => y < p / 2).length / Ns;
    $('st-xy-obs').innerHTML =
      `Su ${nf(Ns)} campioni compaiono <b>${nf(new Set(S.xs).size)}</b> valori distinti di x. ` +
      `Solo <b>${nf(validX)}</b> dei ${nf(p)} elementi di F<sub>p</sub> (${pct(validX / p)}) sono ascisse di punti di ⟨G⟩: ` +
      `gli altri non possono comparire mai, perché per loro x³ + ${C.b} non è un quadrato modulo p` +
      (n < Npts ? ' (oppure il punto non sta nel sottogruppo generato da G)' : '') + '. ' +
      `y pari nel ${pct(evenY)} dei casi, y &lt; p/2 nel ${pct(lowY)}. ` +
      (full && yTriples ? 'Ogni valore di y compare invece <b>0 o 3 volte</b>' + (yCounts.has(1) ? ' (eccetto i punti con x = 0, per cui βx = x)' : '') + ': per p ≡ 1 (mod 3) esiste una radice cubica dell’unità β ≠ 1, e (x, y), (βx, y), (β²x, y) stanno tutti sulla curva perché (βx)³ = x³ (lo stesso "endomorfismo" che su secp256k1 si usa per accelerare i calcoli). Per questo il χ² di y contro l’uniforme è più alto di quello di x. ' : '') +
      (full ? 'Con k che percorre <i>tutti</i> i valori 1…n−1 il campione coincide con l\'intero sottogruppo: la seconda ipotesi è soddisfatta esattamente (χ² = 0), non per caso ma perché k ↦ kG è una biiezione.'
        : 'Con k casuali la seconda ipotesi non viene rifiutata (se p-value &gt; 0,05), come previsto: k uniforme ⇒ kG uniforme su ⟨G⟩.');

    // --- 2. frequenze dei singoli valori di x
    const cnt = new Map();
    S.xs.forEach(x => cnt.set(x, (cnt.get(x) || 0) + 1));
    const freqOf = new Map();
    for (let x = 0; x < p; x++) { const c = cnt.get(x) || 0; freqOf.set(c, (freqOf.get(c) || 0) + 1); }
    const maxC = Math.max(...freqOf.keys());
    const CMAX = Math.min(maxC, 14);
    const fcats = [], fobs = [], fexp = [];
    // atteso se x fosse uniforme su F_p: numero di valori con frequenza c ~ p · Binomiale(Ns, 1/p)
    const lam = Ns / p;
    let logPmf = Ns * Math.log1p(-1 / p);       // c = 0
    for (let c = 0; c <= CMAX; c++) {
      if (c > 0) logPmf += Math.log((Ns - c + 1) / c) + Math.log(1 / p) - Math.log1p(-1 / p);
      fcats.push(c === CMAX && maxC > CMAX ? `≥${c}` : String(c));
      let o = freqOf.get(c) || 0;
      if (c === CMAX && maxC > CMAX) for (const [cc, v] of freqOf) if (cc > CMAX) o += v;
      fobs.push(o);
      fexp.push(p * Math.exp(logPmf));
    }
    Charts.bars('#st-freq-chart', {
      categories: fcats,
      series: [{ name: 'osservato', color: 'var(--series-1)', values: fobs }, { name: 'atteso se x uniforme su F_p', color: 'var(--series-2)', values: fexp }],
      xLabel: 'quante volte compare un valore di x', yLabel: 'n. di valori',
      tooltip: i => `<b>valori di x che compaiono ${fcats[i]} volt${fcats[i] === '1' ? 'a' : 'e'}</b><br>osservati: ${nf(fobs[i])}<br>attesi (uniforme): ${nf(fexp[i], 1)}`,
      height: 210
    });
    const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    $('st-freq-obs').innerHTML =
      `Media attesa per valore (uniforme su F<sub>p</sub>): ${nf(lam)}. ` +
      `${nf(freqOf.get(0) || 0)} valori di x non compaiono mai. ` +
      `Valori più frequenti: ${top.map(([x, c]) => `${x} (${c}×)`).join(', ')}. ` +
      (full ? 'Con l\'enumerazione completa ogni ascissa valida compare <b>esattamente due volte</b> (per kG e −kG = (n−k)G, che hanno la stessa x) e le altre zero: una distribuzione rigidissima, per nulla "casuale".'
        : 'Il confronto con la binomiale mostra l\'eccesso di zeri: metà dei valori non è raggiungibile, quindi quelli raggiungibili compaiono in media il doppio.');

    // --- 3. distribuzione dei bit
    const expBit = j => { // frazione di v ∈ [0, p) con bit j = 1
      const blk = 2 ** (j + 1), half = 2 ** j;
      return (Math.floor(p / blk) * half + Math.max(0, (p % blk) - half)) / p;
    };
    const bitCats = [], bx = [], by = [], be = [];
    for (let j = m - 1; j >= 0; j--) {
      bitCats.push('b' + j);
      let ox = 0, oy = 0;
      for (let i = 0; i < Ns; i++) { if ((S.xs[i] >> j) & 1) ox++; if ((S.ys[i] >> j) & 1) oy++; }
      bx.push(ox / Ns); by.push(oy / Ns); be.push(expBit(j));
    }
    Charts.bars('#st-bits-chart', {
      categories: bitCats,
      series: [{ name: 'bit di x', color: 'var(--series-1)', values: bx }, { name: 'bit di y', color: 'var(--series-3)', values: by }],
      expected: be, ref: { value: 0.5, label: '0,5' }, yMax: 1,
      yFormat: v => nf(v, 2), xLabel: 'posizione del bit (b' + (m - 1) + ' = più significativo)', yLabel: 'frazione di 1',
      tooltip: i => `<b>${bitCats[i]}</b><br>x: ${pct(bx[i])} di 1<br>y: ${pct(by[i])} di 1<br>atteso se uniforme su [0, p): ${pct(be[i])}`,
      height: 220
    });
    const allOnes = (bx.reduce((a, b) => a + b, 0) + by.reduce((a, b) => a + b, 0)) / (2 * m);
    const lsbY = by[by.length - 1];
    $('st-bits-obs').innerHTML =
      `Frazione complessiva di bit a 1: <b>${pct(allOnes)}</b>. Bit più significativo: ${pct(bx[0])} (x) e ${pct(by[0])} (y), ` +
      `contro un valore atteso di ${pct(be[0])} anche per numeri perfettamente uniformi in [0, ${p}): ` +
      `poiché p = ${p} non è una potenza di 2 (2<sup>${m}</sup> = ${nf(2 ** m)}), il bit alto è <b>strutturalmente sbilanciato</b>. ` +
      `Il bit meno significativo di y (parità) vale 1 nel ${pct(lsbY)} dei casi: è proprio il bit salvato nelle chiavi pubbliche compresse (prefisso 02/03).`;

    // --- 4. correlazioni input/output
    const idx = [...Array(Ns).keys()];
    const step = Math.max(1, Math.ceil(Ns / 2500));
    const scatterPts = idx.filter(i => i % step === 0).map(i => ({ x: S.ks[i], y: S.xs[i], yy: S.ys[i] }));
    Charts.scatter('#st-corr-chart', {
      points: scatterPts, xMax: n, yMax: p, xLabel: 'chiave privata k', yLabel: 'x(kG)',
      tooltip: pt => `k = ${pt.x}<br>kG = (${pt.y}, ${pt.yy})`
    });
    const rKX = pearson(S.ks, S.xs), rKY = pearson(S.ks, S.ys), rXY = pearson(S.xs, S.ys), sKX = spearman(S.ks, S.xs);
    const thr = 2 / Math.sqrt(Ns);
    let serial = null;
    if (full) serial = pearson(S.xs.slice(0, -1), S.xs.slice(1));
    // strutture algebriche esatte
    const T = Math.min(2000, Ns);
    let symOK = 0, homOK = 0;
    for (let t = 0; t < T; t++) {
      const k = randInt(1, n - 1);
      if (sub[n - k - 1].x === sub[k - 1].x) symOK++;            // x(kG) = x((n−k)G)
      const a = randInt(1, n - 1), b = randInt(1, n - 1);
      const lhs = (a + b) % n === 0 ? E.INF : sub[((a + b) % n) - 1];
      if (E.samePoint(lhs, E.pointAdd(C, sub[a - 1], sub[b - 1]))) homOK++;   // (a+b)G = aG + bG
    }
    const sig = r => (Math.abs(r) > thr ? '<span class="part">sopra la soglia</span>' : 'compatibile con 0');
    $('st-corr-table').innerHTML = `
      <table><thead><tr><th>Misura</th><th class="num">Valore</th><th>Lettura (soglia ≈ 2/√N = ${nfx(thr, 3)})</th></tr></thead><tbody>
        <tr><td>Pearson r(k, x)</td><td class="num">${nfx(rKX, 4)}</td><td>${sig(rKX)}</td></tr>
        <tr><td>Spearman ρ(k, x)</td><td class="num">${nfx(sKX, 4)}</td><td>${sig(sKX)}</td></tr>
        <tr><td>Pearson r(k, y)</td><td class="num">${nfx(rKY, 4)}</td><td>${sig(rKY)}</td></tr>
        <tr><td>Pearson r(x, y)</td><td class="num">${nfx(rXY, 4)}</td><td>${sig(rXY)}</td></tr>
        ${serial !== null ? `<tr><td>Autocorrelazione r(x<sub>k</sub>, x<sub>k+1</sub>)</td><td class="num">${nfx(serial, 4)}</td><td>${sig(serial)}</td></tr>` : ''}
        <tr><td>Simmetria x(kG) = x((n−k)G)</td><td class="num">${pct(symOK / T, 0)}</td><td>su ${nf(T)} k casuali</td></tr>
        <tr><td>Omomorfismo (a+b)G = aG + bG</td><td class="num">${pct(homOK / T, 0)}</td><td>su ${nf(T)} coppie casuali</td></tr>
      </tbody></table>`;
    $('st-corr-obs').innerHTML =
      'Le correlazioni lineari e di rango sono trascurabili: guardando il grafico non si "vede" k a partire da x. ' +
      (full ? 'Nell’enumerazione completa r(k, x) è <b>esattamente</b> zero, ma non perché la funzione sia "casuale": è proprio la simmetria x(kG) = x((n−k)G) ad annullare la covarianza. Allo stesso modo r(x, y) = 0 per la simmetria y ↔ p − y. ' : '') +
      'Ma la tabella mostra due relazioni <b>esatte</b> che nessun indice di correlazione cattura: ' +
      'la simmetria x(kG) = x(−kG) (il grafico è speculare rispetto a k = n/2) e l\'additività (a+b)G = aG + bG.';

    // --- 5. effetto valanga: ECC vs SHA-256
    const L = bitLength(n - 1);
    const trials = Math.min(400, Math.max(50, Math.floor(20000 / L)));
    const pow2G = [];                                 // 2^j · G, per la "previsione" senza conoscere k
    for (let j = 0; j < L; j++) pow2G.push(E.scalarMult(C, 2 ** j % n || n, G));
    const hdE = new Array(m + 1).fill(0), hdH = new Array(m + 1).fill(0);
    const sacE = new Array(m).fill(0), sacH = new Array(m).fill(0);
    let tot = 0, sumE = 0, sumH = 0, predOK = 0;
    const kBuf = new Uint8Array(4), dv = new DataView(kBuf.buffer);
    const hashBits = k => { dv.setUint32(0, k); const h = window.Hashes.sha256(kBuf); return ((h[0] << 24 | h[1] << 16 | h[2] << 8 | h[3]) >>> 0) >>> (32 - m); };
    for (let t = 0; t < trials; t++) {
      const k = randInt(1, n - 1);
      const Q = sub[k - 1];
      const hk = hashBits(k);
      for (let j = 0; j < L; j++) {
        const k2 = k ^ (1 << j);
        if (k2 < 1 || k2 > n - 1) continue;
        const Q2 = sub[k2 - 1];
        const d1 = Q.x ^ Q2.x;
        const d2 = hk ^ hashBits(k2);
        const he = popcount(d1), hh = popcount(d2);
        hdE[he]++; hdH[hh]++; sumE += he; sumH += hh; tot++;
        for (let b = 0; b < m; b++) { if ((d1 >> b) & 1) sacE[b]++; if ((d2 >> b) & 1) sacH[b]++; }
        // previsione: Q2 = Q ± 2^j·G, calcolabile da Q senza conoscere k
        const guess = k2 > k ? E.pointAdd(C, Q, pow2G[j]) : E.pointAdd(C, Q, E.negate(C, pow2G[j]));
        if (E.samePoint(guess, Q2)) predOK++;
      }
    }
    // atteso per bit indipendenti a probabilità 1/2: Binomiale(m, 1/2)
    let binom = 1; const expHD = [];
    for (let h = 0; h <= m; h++) { expHD.push((tot * binom) / 2 ** m); binom = (binom * (m - h)) / (h + 1); }
    Charts.bars('#st-aval-chart', {
      categories: [...Array(m + 1).keys()],
      series: [{ name: 'moltiplicazione scalare (x di kG)', color: 'var(--series-1)', values: hdE }, { name: `SHA-256 (primi ${m} bit)`, color: 'var(--series-2)', values: hdH }],
      expected: expHD, xLabel: `bit di output cambiati (su ${m}) dopo aver invertito 1 bit di k`, yLabel: 'n. prove',
      tooltip: i => `<b>${i} bit cambiati</b><br>EC: ${nf(hdE[i])}<br>SHA-256: ${nf(hdH[i])}<br>atteso (bit casuali): ${nf(expHD[i], 1)}`,
      height: 220
    });
    const sacCats = [], sE = [], sH = [];
    for (let b = m - 1; b >= 0; b--) { sacCats.push('b' + b); sE.push(sacE[b] / tot); sH.push(sacH[b] / tot); }
    Charts.bars('#st-sac-chart', {
      categories: sacCats,
      series: [{ name: 'EC', color: 'var(--series-1)', values: sE }, { name: 'SHA-256', color: 'var(--series-2)', values: sH }],
      ref: { value: 0.5, label: '0,5' }, yMax: 1, yFormat: v => nf(v, 2),
      xLabel: 'bit di output', yLabel: 'P(il bit cambia)',
      tooltip: i => `<b>${sacCats[i]}</b><br>EC: ${pct(sE[i])}<br>SHA-256: ${pct(sH[i])}`,
      height: 200
    });
    $('st-aval-obs').innerHTML =
      `Su ${nf(tot)} inversioni di un singolo bit di k cambiano in media <b>${nf(sumE / tot)}</b> bit su ${m} della x di kG ` +
      `(${pct(sumE / tot / m)}) e <b>${nf(sumH / tot)}</b> bit dei primi ${m} di SHA-256 (${pct(sumH / tot / m)}); l'ideale è il 50%. ` +
      `Però nel <b>${pct(predOK / tot, 0)}</b> dei casi il nuovo punto si ottiene <i>senza conoscere k</i>, come Q ± 2<sup>j</sup>G: ` +
      'l\'output "sembra" cambiare a valanga, ma la relazione tra le due uscite è perfettamente prevedibile. ' +
      (sE[0] < 0.3 ? `Nel secondo grafico il bit più alto della x cambia solo nel ${pct(sE[0])} dei casi: è lo stesso sbilanciamento visto in 5.3, mentre SHA-256 resta vicino al 50% su ogni bit. ` : '') +
      (m < 8 ? 'Con così pochi bit (p piccolo) le percentuali sono molto rumorose: prova p = 65419.' : '');

    // --- 6. inversione a forza bruta
    $('st-brute-out').textContent = '';
  }

  /* ------------------------ attacco a forza bruta ------------------------- */
  function brute() {
    if (!cur) setupCurve(true);
    const { C, G, n } = cur;
    const k = randInt(1, n - 1);
    const Q = E.scalarMult(C, k, G);
    const t0 = performance.now();
    let R = G, i = 1;
    while (!E.samePoint(R, Q)) { R = E.pointAdd(C, R, G); i++; }
    const ms = performance.now() - t0;
    // stima più stabile della velocità: 20 000 addizioni di prova
    const b0 = performance.now();
    let T = G;
    for (let j = 0; j < 20000; j++) T = E.pointAdd(C, T, G) || G;
    const opsPerSec = 20000 / Math.max(performance.now() - b0, 0.01) * 1000;
    const log10 = Math.log10;
    const rhoOps = Math.sqrt(Math.PI * 1.158e77 / 4);                 // Pollard rho su secp256k1 (n ≈ 1,158·10^77)
    const years = rhoOps / opsPerSec / 3.156e7;
    const sci = v => { const e = Math.floor(log10(v)); return `${nfx(v / 10 ** e, 1)}·10^${e}`; };
    $('st-brute-out').innerHTML =
      `Chiave segreta estratta: k = ${nf(k)}, Q = ${E.fmt(Q)}. Trovata con <b>${nf(i)}</b> addizioni in ${nf(ms, 1)} ms ` +
      `(≈ ${sci(opsPerSec)} operazioni/s in questo browser).<br>` +
      `Su secp256k1 (n ≈ 2<sup>256</sup>) anche l'algoritmo migliore noto (Pollard rho, ≈ √(πn/4) ≈ ${sci(rhoOps)} operazioni) ` +
      `richiederebbe a questa velocità circa <b>${sci(years)} anni</b>. L'età dell'universo è ≈ 1,4·10^10 anni.`;
  }

  /* -------------------------------- avvio --------------------------------- */
  ui.preset.innerHTML = Object.entries(PRESETS).map(([id, pr]) => `<option value="${id}">${pr.label}</option>`).join('');
  ui.preset.value = 'p1051';
  const syncMode = () => { $('st-N-field').style.display = ui.mode.value === 'random' ? '' : 'none'; };
  ui.mode.addEventListener('change', syncMode);
  ui.preset.addEventListener('change', () => { try { setupCurve(false); run(); } catch (e) { ui.status.textContent = 'Errore: ' + e.message; } });
  ui.newG.addEventListener('click', () => {
    try {
      if (!cur) setupCurve(false);
      const P = randomPoint(cur.C, cur.n);
      cur.G = P;
      setupCurve(true);
      run();
    } catch (e) { ui.status.textContent = 'Errore: ' + e.message; }
  });
  ui.run.addEventListener('click', run);
  $('st-brute').addEventListener('click', brute);
  syncMode();
  try { setupCurve(false); run(); } catch (e) { ui.status.textContent = 'Errore: ' + e.message; }
})();

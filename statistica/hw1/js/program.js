/* ==========================================================================
   program.js — il "programma" richiesto dalla traccia:
   definisce curva, punto base G e chiave privata k, stampa G, 2G, …, kG
   (addizioni ripetute) e poi il metodo veloce double-and-add, infine la
   TOY PUBLIC KEY. La configurazione è condivisa con la visualizzazione.
   ========================================================================== */
(function () {
  'use strict';
  const { makeCurve, allPoints, countPoints, pointOrder, multiplesOf, scalarMult, fmt, mod, INF } = window.ECC;

  // Curve preimpostate (stessa equazione di secp256k1: y² = x³ + 7).
  const PRESETS = [
    { id: '17', p: 17, b: 7, G: { x: 1, y: 5 }, label: 'p = 17 (traccia dell\'homework)' },
    { id: '43', p: 43, b: 7, G: null, label: 'p = 43 (#E = 31, primo)' },
    { id: '97', p: 97, b: 7, G: null, label: 'p = 97 (#E = 79, primo)' },
    { id: '163', p: 163, b: 7, G: null, label: 'p = 163 (#E = 139, primo)' },
    { id: 'custom', label: 'Personalizzata…' }
  ];

  const $ = id => document.getElementById(id);
  const ui = {
    preset: $('cfg-preset'), p: $('cfg-p'), b: $('cfg-b'), G: $('cfg-G'), k: $('cfg-k'),
    run: $('cfg-run'), err: $('cfg-err'), out: $('console'), key: $('toy-key'), eq: $('cfg-eq')
  };

  const state = window.HW1 = window.HW1 || {};

  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const sup = n => String(n).replace(/[0-9-]/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(d)] || '⁻');
  const sub = n => String(n).replace(/[0-9]/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);
  const pad = (s, n) => (s + ' '.repeat(Math.max(0, n - s.length)));

  function fillPresets() {
    ui.preset.innerHTML = PRESETS.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
  }

  // Popola il menu dei punti base con tutti i punti della curva e il loro ordine.
  function fillPoints(C, preferred) {
    const pts = allPoints(C);
    state.points = pts;
    const opts = [];
    const max = Math.min(pts.length, 400);
    for (let i = 0; i < max; i++) {
      const P = pts[i];
      const ord = pointOrder(C, P);
      opts.push({ P, ord });
    }
    // per default: il punto suggerito, altrimenti il primo di ordine massimo
    let sel = 0;
    if (preferred) {
      const i = opts.findIndex(o => o.P.x === preferred.x && o.P.y === preferred.y);
      if (i >= 0) sel = i;
    } else {
      let best = -1;
      opts.forEach((o, i) => { if (o.ord > best) { best = o.ord; sel = i; } });
    }
    ui.G.innerHTML = opts.map((o, i) =>
      `<option value="${o.P.x},${o.P.y}"${i === sel ? ' selected' : ''}>(${o.P.x}, ${o.P.y}) · ordine ${o.ord}</option>`).join('');
  }

  function readConfig() {
    const p = parseInt(ui.p.value, 10);
    const b = parseInt(ui.b.value, 10);
    const C = makeCurve(p, 0, b);
    if (p > 2000) throw new Error('per questa pagina usa p ≤ 2000 (per p grandi vedi l\'esplorazione statistica)');
    const [gx, gy] = ui.G.value.split(',').map(Number);
    const G = { x: gx, y: gy };
    const k = Number(ui.k.value);
    if (!Number.isSafeInteger(k) || k < 1) throw new Error('k deve essere un intero ≥ 1');
    return { C, G, k };
  }

  function lambdaText(C, info) {
    if (info.kind === 'double') {
      return `tangente  λ = (3x²)/(2y) = ${info.num}·${info.den}${sup(-1)} = ${info.num}·${info.inv} ≡ ${info.lambda}`;
    }
    if (info.kind === 'add') {
      return `corda     λ = (y₂−y₁)/(x₂−x₁) = ${info.num}·${info.den}${sup(-1)} = ${info.num}·${info.inv} ≡ ${info.lambda}`;
    }
    if (info.kind === 'inverse') return 'P + (−P): retta verticale → O';
    return '';
  }

  function run() {
    ui.err.textContent = '';
    let cfg;
    try { cfg = readConfig(); } catch (e) { ui.err.textContent = e.message; return; }
    const { C, G, k } = cfg;
    const p = C.p;
    const N = countPoints(C);
    const n = pointOrder(C, G);
    Object.assign(state, { C, G, k, N, n });

    const L = [];
    const h = s => L.push(`<span class="c-h">${esc(s)}</span>`);
    const m = s => L.push(`<span class="c-m">${esc(s)}</span>`);
    const t = s => L.push(esc(s));

    h('// 1. Curva giocattolo e punto base');
    t(`E: y² = x³ + ${C.b}  (mod ${p})`);
    t(`#E(F${sub(p)}) = ${N} punti  (${N - 1} punti affini + il punto all'infinito O)`);
    const lhs = mod(G.y * G.y, p), rhs = mod(G.x * G.x * G.x + C.b, p);
    t(`G = ${fmt(G)}   verifica: ${G.y}² mod ${p} = ${lhs},  ${G.x}³ + ${C.b} mod ${p} = ${rhs}  ` + (lhs === rhs ? '✓' : '✗'));
    t(`ord(G) = ${n}   → ${n}G = O: i multipli di G si ripetono con periodo ${n}`);
    t(`k = ${k}${k >= n ? `   (k ≥ ord(G): kG = (k mod ${n})G = ${k % n}G)` : ''}   ← chiave privata`);
    t('');

    // Metodo 1: tutti i multipli
    const LIST_MAX = 2000;
    let Q1 = null;
    h('// 2. Metodo 1 — addizioni ripetute: G, 2G, 3G, …, kG');
    if (k <= LIST_MAX) {
      const list = multiplesOf(C, G, k);
      const w = String(k).length;
      list.forEach(({ k: i, P, info }) => {
        const left = pad(`${String(i).padStart(w)}G = ` + (i === 1 ? 'G' : `${i - 1}G + G`), w * 2 + 12);
        const val = pad(fmt(P), 10);
        const line = esc(`${left} = ${val}`) + (info ? ` <span class="c-m">${esc(lambdaText(C, info))}</span>` : '') +
          (P === INF ? ' <span class="c-m">← punto all\'infinito</span>' : '');
        L.push(line);
      });
      Q1 = list[list.length - 1].P;
      m(`addizioni eseguite: ${k - 1}`);
    } else {
      m(`k > ${LIST_MAX}: troppi passi da elencare, uso solo il metodo veloce.`);
    }
    t('');

    // Metodo 2: double-and-add
    const bits = k.toString(2);
    h(`// 3. Metodo 2 — double-and-add:  k = ${k} = ${bits}${sub(2)}`);
    let nd = 0, na = 0;
    const Q2 = scalarMult(C, k, G, s => {
      const val = pad(fmt(s.after), 10);
      if (s.op === 'start') t(`bit ${s.bit}  R = G          = ${val}  [${s.acc}G]`);
      if (s.op === 'double') {
        nd++;
        L.push(esc(`bit ${s.bit}  R = 2R         = ${val}  [${s.acc}G]`) + `  <span class="c-m">${esc(lambdaText(C, s.info))}</span>`);
      }
      if (s.op === 'add') {
        na++;
        L.push(esc(`       R = R + G      = ${val}  [${s.acc}G]`) + `  <span class="c-m">${esc(lambdaText(C, s.info))}</span>`);
      }
    });
    const pl = (c, one, many) => `${c} ${c === 1 ? one : many}`;
    m(`operazioni: ${pl(nd, 'raddoppio', 'raddoppi')} + ${pl(na, 'addizione', 'addizioni')} = ${nd + na}` +
      (k > 1 ? `  (contro ${pl(k - 1, 'addizione', 'addizioni')} del metodo 1)` : ''));
    if (k <= LIST_MAX) {
      L.push(`<span class="c-ok">${esc('controllo: i due metodi danno lo stesso punto ' + (window.ECC.samePoint(Q1, Q2) ? '✓' : '✗'))}</span>`);
    }
    t('');
    L.push(`<span class="c-key">${esc(`TOY PUBLIC KEY:  Q = ${k}G = ${fmt(Q2)}`)}</span>`);

    ui.out.innerHTML = L.join('\n');
    ui.key.textContent = `Q = ${k}·G = ${fmt(Q2)}`;
    ui.eq.textContent = `y² = x³ + ${C.b} (mod ${p}),  G = ${fmt(G)},  k = ${k}`;
    state.Q = Q2;
    document.dispatchEvent(new CustomEvent('hw1-config'));
  }

  function applyPreset(id) {
    const pr = PRESETS.find(p => p.id === id);
    if (!pr || id === 'custom') return;
    ui.p.value = pr.p;
    ui.b.value = pr.b;
    try {
      fillPoints(makeCurve(pr.p, 0, pr.b), pr.G);
    } catch (e) { ui.err.textContent = e.message; }
  }

  function onCurveEdit() {
    ui.preset.value = 'custom';
    ui.err.textContent = '';
    try {
      const p = parseInt(ui.p.value, 10);
      if (p > 2000) throw new Error('per questa pagina usa p ≤ 2000');
      fillPoints(makeCurve(p, 0, parseInt(ui.b.value, 10)));
      run();
    } catch (e) { ui.err.textContent = e.message; }
  }

  // Mostra il codice sorgente delle due funzioni chiave direttamente dalla libreria caricata.
  function showSource() {
    const hl = src => esc(src).split('\n').map(line => {
      const i = line.indexOf('//');
      return i >= 0 ? line.slice(0, i) + '<span class="c-m">' + line.slice(i) + '</span>' : line;
    }).join('\n');
    const dedent = s => {
      const lines = s.split('\n');
      const ind = Math.min(...lines.slice(1).filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
      return [lines[0], ...lines.slice(1).map(l => l.slice(ind))].join('\n');
    };
    document.querySelectorAll('[data-source]').forEach(pre => {
      const fn = window.ECC[pre.dataset.source];
      if (fn) pre.innerHTML = hl(dedent(fn.toString()));
    });
  }

  fillPresets();
  ui.preset.value = '17';
  applyPreset('17');
  ui.preset.addEventListener('change', () => { applyPreset(ui.preset.value); run(); });
  ui.p.addEventListener('change', onCurveEdit);
  ui.b.addEventListener('change', onCurveEdit);
  ui.G.addEventListener('change', run);
  ui.k.addEventListener('change', run);
  ui.run.addEventListener('click', run);
  ui.k.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  showSource();
  run();
})();

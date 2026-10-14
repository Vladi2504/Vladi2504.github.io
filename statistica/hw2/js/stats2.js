/* ==========================================================================
   stats2.js — proprietà statistiche della pipeline del wallet.

   E1  parole BIP-39: uniformità e probabilità che una frase casuale sia valida
   E2  effetto valanga lungo la pipeline (1 bit di entropia cambiato)
   E3  gli indirizzi di un wallet: cifre esadecimali, bit, lettere EIP-55
   E4  capacità di rilevare errori delle checksum (BIP-39, EIP-55)
   E5  SHA-256, Keccak-256, SHA3-256, SHA-512 a confronto
   ========================================================================== */
(function () {
  'use strict';
  const { toHex, utf8, randomBytes, sha256, keccak256, sha3_256, sha512, hamming, popcount8, bytesToBig } = window.Prim;
  const W = window.Wallet, S = window.Secp, Charts = window.Charts;
  const $ = id => document.getElementById(id);
  const nf = (v, d = 2) => Number(v).toLocaleString('it-IT', { maximumFractionDigits: d });
  const nfx = (v, d) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : Number(v)).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 1) => nfx(100 * v, d) + '%';
  const sci = v => { if (v === 0) return '0'; const e = Math.floor(Math.log10(v)); return `${nfx(v / 10 ** e, 2)}·10<sup>${e}</sup>`; };
  // Cede il controllo al browser con un messaggio (a differenza di setTimeout non viene rallentato nelle schede in background).
  const channel = new MessageChannel(), waiting = [];
  channel.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
  const tick = () => new Promise(r => { waiting.push(r); channel.port2.postMessage(0); });
  // Nei cicli lunghi restituisce il controllo al browser ogni ~40 ms, così la pagina resta reattiva.
  let lastYield = 0;
  async function breathe() { if (performance.now() - lastYield > 40) { await tick(); lastYield = performance.now(); } }

  /* ------------------------------ statistica ------------------------------ */
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
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return lead * h;
  }
  function chi2(obs, exp) {
    let chi = 0, df = -1;
    obs.forEach((o, i) => { if (exp[i] > 0) { chi += (o - exp[i]) ** 2 / exp[i]; df++; } });
    return { chi, df, p: df > 0 ? gammaQ(df / 2, chi / 2) : 1 };
  }
  const fmtP = v => (v < 1e-4 ? '< 0,0001' : nfx(v, 4));
  const meanSd = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1 || 1); return [m, Math.sqrt(v)]; };
  function pearson(a, b) {
    const [ma] = meanSd(a), [mb] = meanSd(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  function binomPmf(n, p) {
    const out = [];
    let lp = n * Math.log(1 - p);
    for (let k = 0; k <= n; k++) {
      if (k > 0) lp += Math.log((n - k + 1) / k) + Math.log(p / (1 - p));
      out.push(Math.exp(lp));
    }
    return out;
  }
  function randInt(n) { // uniforme in [0, n)
    const lim = Math.floor(0x100000000 / n) * n, b = new Uint32Array(1);
    for (;;) { crypto.getRandomValues(b); if (b[0] < lim) return b[0] % n; }
  }
  const status = (id, s) => { $(id).innerHTML = s; };

  // Controllo veloce della checksum BIP-39 a partire dagli indici delle parole.
  function checksumOk(indices) {
    const nbits = indices.length * 11, CS = nbits / 33, ENT = nbits - CS;
    let big = 0n;
    for (const i of indices) big = (big << 11n) | BigInt(i);
    const ent = big >> BigInt(CS);
    const cs = Number(big & ((1n << BigInt(CS)) - 1n));
    const bytes = new Uint8Array(ENT / 8);
    let e = ent;
    for (let i = bytes.length - 1; i >= 0; i--) { bytes[i] = Number(e & 255n); e >>= 8n; }
    const h = sha256(bytes);
    const top = CS <= 8 ? h[0] >> (8 - CS) : (h[0] << (CS - 8)) | (h[1] >> (16 - CS));
    return top === cs;
  }

  /* ------------------------------- E1 ------------------------------------- */
  async function e1() {
    status('e1-status', 'Calcolo…'); await tick();
    const N = 3000;
    const bins = 32, all = new Array(bins).fill(0), last = new Array(bins).fill(0), first = new Array(bins).fill(0);
    for (let t = 0; t < N; t++) {
      await breathe();
      const m = W.entropyToMnemonic(randomBytes(16));
      m.indices.forEach((ix, j) => { const b = ix >> 6; all[b]++; if (j === 11) last[b]++; if (j === 0) first[b]++; });
    }
    const cats = [...Array(bins)].map((_, i) => i * 64);
    const expAll = new Array(bins).fill((12 * N) / bins);
    Charts.bars('#e1-chart', {
      categories: cats, series: [{ name: 'parole', color: 'var(--series-1)', values: all }], expected: expAll,
      xLabel: 'indice della parola nella lista (classi da 64 parole)', yLabel: 'frequenza', height: 200,
      tooltip: i => `<b>parole ${cats[i]}–${cats[i] + 63}</b><br>${window.Wallet.words[cats[i]]} … ${window.Wallet.words[cats[i] + 63]}<br>osservate: ${nf(all[i])}<br>attese: ${nf(expAll[i], 0)}`
    });
    const cA = chi2(all, expAll), cF = chi2(first, new Array(bins).fill(N / bins)), cL = chi2(last, new Array(bins).fill(N / bins));

    // frasi casuali: probabilità che la checksum sia valida per caso
    const M = 40000;
    let v12 = 0, v24 = 0;
    for (let t = 0; t < M; t++) {
      await breathe();
      if (checksumOk([...Array(12)].map(() => randInt(2048)))) v12++;
      if (checksumOk([...Array(24)].map(() => randInt(2048)))) v24++;
    }
    $('e1-table').innerHTML = `<table><thead><tr><th>Test</th><th class="num">Valore</th><th class="num">p-value</th><th>Lettura</th></tr></thead><tbody>
      <tr><td>χ² uniformità, tutte le parole (${nf(12 * N)} parole, 32 classi)</td><td class="num">${nf(cA.chi)}</td><td class="num">${fmtP(cA.p)}</td><td>${cA.p > 0.01 ? 'compatibile con l’uniforme' : 'scostamento'}</td></tr>
      <tr><td>χ² uniformità, solo la 1ª parola</td><td class="num">${nf(cF.chi)}</td><td class="num">${fmtP(cF.p)}</td><td>${cF.p > 0.01 ? 'compatibile con l’uniforme' : 'scostamento'}</td></tr>
      <tr><td>χ² uniformità, solo la 12ª parola (contiene la checksum)</td><td class="num">${nf(cL.chi)}</td><td class="num">${fmtP(cL.p)}</td><td>${cL.p > 0.01 ? 'compatibile con l’uniforme' : 'scostamento'}</td></tr>
      <tr><td>12 parole scelte a caso con checksum valida</td><td class="num">${pct(v12 / M, 2)}</td><td class="num">—</td><td>teorico 1/16 = 6,25% (${nf(M)} prove)</td></tr>
      <tr><td>24 parole scelte a caso con checksum valida</td><td class="num">${pct(v24 / M, 2)}</td><td class="num">—</td><td>teorico 1/256 ≈ 0,39%</td></tr>
    </tbody></table>`;
    status('e1-status', `${nf(N)} frasi da 12 parole generate da entropia casuale.`);
  }

  /* ------------------------------- E2 ------------------------------------- */
  async function pipeline(entropy) {
    const m = W.entropyToMnemonic(entropy);
    const seed = await W.mnemonicToSeed(m.words, '');
    const mk = await W.masterKey(seed);
    const leaf = await W.derivePath(mk, "m/44'/60'/0'/0/0");
    const a = W.keyToAddress(leaf.k);
    const big = BigInt('0b' + m.groups.join(''));
    return {
      ent: entropy, words: m.words, mnBits: big, seed,
      mk: window.Prim.bigToBytes(mk.k, 32), cc: mk.c,
      leaf: window.Prim.bigToBytes(leaf.k, 32), pub: a.pub.raw, addr: a.hash.slice(12)
    };
  }
  async function e2() {
    const T = 40;
    const st = [
      ['Entropia', 128, 'gen'], ['Mnemonica (bit codificati)', 132, 'enc'], ['Seed (PBKDF2)', 512, 'der'],
      ['Chiave master', 256, 'der'], ['Chain code master', 256, 'der'], ['Chiave privata m/44\'/60\'/0\'/0/0', 256, 'der'],
      ['Chiave pubblica (x‖y)', 512, 'pk'], ['Indirizzo (20 byte)', 160, 'hash']
    ];
    const res = st.map(() => []);
    const wordsChanged = [];
    for (let t = 0; t < T; t++) {
      if (t % 5 === 0) { status('e2-status', `Calcolo… ${t}/${T} coppie`); await tick(); }
      const e = randomBytes(16);
      const e2b = e.slice(); const bit = randInt(128); e2b[bit >> 3] ^= 1 << (7 - (bit & 7));
      const [A, B] = [await pipeline(e), await pipeline(e2b)];
      let x = A.mnBits ^ B.mnBits, hd = 0; while (x) { hd += Number(x & 1n); x >>= 1n; }
      wordsChanged.push(A.words.filter((w, i) => w !== B.words[i]).length);
      const pairs = [[A.ent, B.ent], null, [A.seed, B.seed], [A.mk, B.mk], [A.cc, B.cc], [A.leaf, B.leaf], [A.pub, B.pub], [A.addr, B.addr]];
      pairs.forEach((p, i) => res[i].push(i === 1 ? hd : hamming(p[0], p[1])));
    }
    const means = res.map((r, i) => meanSd(r)[0] / st[i][1]);
    Charts.bars('#e2-chart', {
      categories: st.map((_, i) => i + 1),
      series: [{ name: 'bit cambiati', color: 'var(--series-1)', values: means }],
      ref: { value: 0.5, label: '50%' }, yMax: 1, yFormat: v => nf(100 * v, 0) + '%', height: 220,
      xLabel: 'passaggio della pipeline (vedi tabella)', yLabel: 'bit cambiati',
      tooltip: i => { const [m, s] = meanSd(res[i]); return `<b>${st[i][0]}</b><br>${nf(m, 1)} bit su ${st[i][1]} (${pct(m / st[i][1])})<br>dev. std ${nf(s, 1)}`; }
    });
    $('e2-table').innerHTML = `<table><thead><tr><th>#</th><th>Passaggio</th><th class="num">Bit</th><th class="num">Bit cambiati (media ± d.s.)</th><th class="num">Frazione</th></tr></thead><tbody>` +
      st.map((s, i) => { const [m, sd] = meanSd(res[i]); return `<tr><td>${i + 1}</td><td><span class="chip ${s[2]}">${s[0]}</span></td><td class="num">${s[1]}</td><td class="num">${nf(m, 1)} ± ${nf(sd, 1)}</td><td class="num">${pct(m / s[1])}</td></tr>`; }).join('') +
      `</tbody></table>`;
    const [wc] = meanSd(wordsChanged);
    $('e2-obs').innerHTML = `Su ${T} coppie di entropie che differiscono per <b>un solo bit</b>, la mnemonica cambia in media <b>${nf(wc, 1)} parole su 12</b>:
      quella che contiene il bit e quasi sempre anche l'ultima, perché cambia la checksum (che resta uguale solo con probabilità 1/16). È una <i>codifica</i> e l'effetto resta locale.
      Dal seed in poi ogni passaggio passa per una funzione hash o una HMAC, e circa <b>metà dei bit</b> cambia a ogni livello.
      Seed, chiavi e indirizzo vicini non hanno nulla in comune.`;
    status('e2-status', `${T} coppie, pipeline completa calcolata ${2 * T} volte.`);
  }

  /* ------------------------------- E3 ------------------------------------- */
  let addrCache = null;
  async function e3() {
    const lab = window.HW2.lab;
    if (!lab) return;
    const N = 512;
    status('e3-status', 'Derivazione degli indirizzi…'); await tick();
    const parent = await W.derivePath(lab.master, "m/44'/60'/0'/0");
    const addrs = [];
    for (let i = 0; i < N; i++) {
      if (i % 64 === 0) { status('e3-status', `Derivazione… ${i}/${N}`); await tick(); }
      const n = await W.ckdPriv(parent, i);
      const a = W.keyToAddress(n.k);
      addrs.push({ i, bytes: a.hash.slice(12), lower: a.lower.slice(2), cs: a.address.slice(2) });
    }
    addrCache = addrs;
    // cifre esadecimali
    const digits = new Array(16).fill(0);
    addrs.forEach(a => { for (const ch of a.lower) digits[parseInt(ch, 16)]++; });
    const expD = new Array(16).fill((40 * N) / 16);
    const cD = chi2(digits, expD);
    Charts.bars('#e3-hex', {
      categories: '0123456789abcdef'.split(''), series: [{ name: 'cifre', color: 'var(--series-1)', values: digits }], expected: expD,
      xLabel: 'cifra esadecimale', yLabel: 'frequenza', height: 190, labelEvery: 1
    });
    // lettere per indirizzo vs Binomiale(40, 6/16)
    const letters = addrs.map(a => (a.lower.match(/[a-f]/g) || []).length);
    const lo = 5, hi = 26;
    const cnt = new Array(hi - lo + 1).fill(0);
    letters.forEach(L => { cnt[Math.min(hi, Math.max(lo, L)) - lo]++; });
    const pmf = binomPmf(40, 6 / 16);
    const expL = cnt.map((_, j) => N * pmf[lo + j]);
    Charts.bars('#e3-letters', {
      categories: cnt.map((_, j) => lo + j), series: [{ name: 'indirizzi', color: 'var(--series-3)', values: cnt }], expected: expL,
      xLabel: 'lettere a–f in un indirizzo (= bit di checksum EIP-55)', yLabel: 'indirizzi', height: 190
    });
    // maiuscole tra le lettere, bit a 1, distanze tra indirizzi consecutivi, correlazione con l'indice
    let up = 0, lt = 0, ones = 0;
    addrs.forEach(a => { for (const ch of a.cs) { if (/[a-fA-F]/.test(ch)) { lt++; if (ch !== ch.toLowerCase()) up++; } } a.bytes.forEach(b => { ones += popcount8(b); }); });
    const hd = [];
    for (let i = 1; i < N; i++) hd.push(hamming(addrs[i - 1].bytes, addrs[i].bytes));
    const [hm, hs] = meanSd(hd);
    const r = pearson(addrs.map(a => a.i), addrs.map(a => Number(bytesToBig(a.bytes.slice(0, 6)))));
    const [lm] = meanSd(letters);
    $('e3-table').innerHTML = `<table><thead><tr><th>Proprietà</th><th class="num">Osservato</th><th class="num">Atteso se uniforme</th></tr></thead><tbody>
      <tr><td>χ² delle 16 cifre esadecimali (p-value)</td><td class="num">${nf(cD.chi)} (${fmtP(cD.p)})</td><td class="num">χ² ≈ 15</td></tr>
      <tr><td>Frazione di bit a 1 (${nf(160 * N)} bit)</td><td class="num">${pct(ones / (160 * N), 2)}</td><td class="num">50%</td></tr>
      <tr><td>Distanza di Hamming tra indirizzi consecutivi i, i+1</td><td class="num">${nf(hm, 1)} ± ${nf(hs, 1)}</td><td class="num">80 ± 6,3</td></tr>
      <tr><td>Correlazione tra indice i e primi 48 bit dell'indirizzo</td><td class="num">${nfx(r, 3)}</td><td class="num">0 (soglia ≈ ±${nfx(2 / Math.sqrt(N), 3)})</td></tr>
      <tr><td>Lettere a–f per indirizzo (media)</td><td class="num">${nf(lm, 2)}</td><td class="num">40 · 6/16 = 15</td></tr>
      <tr><td>Lettere maiuscole dopo EIP-55</td><td class="num">${pct(up / lt, 1)}</td><td class="num">50%</td></tr>
    </tbody></table>`;
    status('e3-status', `${N} indirizzi consecutivi m/44'/60'/0'/0/0 … /${N - 1} della frase del laboratorio.`);
  }

  /* ------------------------------- E4 ------------------------------------- */
  async function e4() {
    if (!addrCache) return;
    status('e4-status', 'Simulazione degli errori di battitura…'); await tick();
    const hex = '0123456789abcdef';
    const T = 100000;
    let undetected = 0, theory = 0;
    for (let t = 0; t < T; t++) {
      await breathe();
      const a = addrCache[randInt(addrCache.length)];
      const pos = randInt(40);
      let c; do { c = hex[randInt(16)]; } while (c === a.lower[pos]);
      const typedLower = a.lower.slice(0, pos) + c + a.lower.slice(pos + 1);
      const typed = a.cs.slice(0, pos) + (randInt(2) ? c.toUpperCase() : c) + a.cs.slice(pos + 1);
      if (W.checksumAddress(typedLower).address.slice(2) === typed) undetected++;
      theory += 2 ** -((typedLower.match(/[a-f]/g) || []).length);
    }
    // inversione maiuscola/minuscola di una lettera: sempre rilevata
    let caseUndet = 0; const T2 = 10000;
    for (let t = 0; t < T2; t++) {
      await breathe();
      const a = addrCache[randInt(addrCache.length)];
      const pos = [...a.cs].map((ch, i) => (/[a-fA-F]/.test(ch) ? i : -1)).filter(i => i >= 0);
      const p = pos[randInt(pos.length)];
      const ch = a.cs[p];
      const typed = a.cs.slice(0, p) + (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) + a.cs.slice(p + 1);
      if (W.checksumAddress(a.lower).address.slice(2) === typed) caseUndet++;
    }
    // BIP-39: una parola sostituita
    const T3 = 40000;
    let w12 = 0, w24 = 0;
    for (let t = 0; t < T3; t++) {
      for (const [len, bytes] of [[12, 16], [24, 32]]) {
        const ix = W.entropyToMnemonic(randomBytes(bytes)).indices;
        const p = randInt(len); let nw; do { nw = randInt(2048); } while (nw === ix[p]);
        ix[p] = nw;
        if (checksumOk(ix)) { if (len === 12) w12++; else w24++; }
      }
      await breathe();
    }
    $('e4-table').innerHTML = `<table><thead><tr><th>Checksum</th><th>Errore simulato</th><th class="num">Prove</th><th class="num">Non rilevati</th><th class="num">Tasso osservato</th><th class="num">Tasso teorico*</th></tr></thead><tbody>
      <tr><td>BIP-39, 12 parole (4 bit)</td><td>una parola sostituita</td><td class="num">${nf(T3)}</td><td class="num">${nf(w12)}</td><td class="num">${pct(w12 / T3, 2)}</td><td class="num">1/16 = 6,25%</td></tr>
      <tr><td>BIP-39, 24 parole (8 bit)</td><td>una parola sostituita</td><td class="num">${nf(T3)}</td><td class="num">${nf(w24)}</td><td class="num">${pct(w24 / T3, 2)}</td><td class="num">1/256 ≈ 0,39%</td></tr>
      <tr><td>EIP-55 (≈ 15 bit)</td><td>un carattere sbagliato</td><td class="num">${nf(T)}</td><td class="num">${nf(undetected)}</td><td class="num">${pct(undetected / T, 4)}</td><td class="num">${pct(theory / T, 4)}</td></tr>
      <tr><td>EIP-55</td><td>maiuscola ↔ minuscola</td><td class="num">${nf(T2)}</td><td class="num">${nf(caseUndet)}</td><td class="num">${pct(caseUndet / T2, 2)}</td><td class="num">0%</td></tr>
    </tbody></table>`;
    $('e4-obs').innerHTML = `Un carattere sbagliato produce un indirizzo diverso, con un hash Keccak-256 indipendente: passa il controllo solo se il caso
      di <i>ogni</i> lettera coincide per puro caso, con probabilità 2<sup>−L</sup> dove L è il numero di lettere. La media su queste prove è
      ${sci(theory / T)}, circa 1 errore su ${nf(T / Math.max(theory, 1e-9), 0)}. Quindi su ${nf(T)} prove ci si aspettano circa
      ${nf(theory, 1)} errori non rilevati, e ne sono stati osservati ${undetected}. Un errore solo di maiuscola/minuscola viene rilevato sempre.
      <br>* Per EIP-55 il tasso teorico è calcolato sugli indirizzi effettivamente usati. La media su <i>tutti</i> gli indirizzi possibili è
      (13/16)<sup>40</sup> ≈ 0,0247%, il valore della specifica. La differenza nasce dal fatto che 𝔼[2<sup>−L</sup>] è dominata dai rari
      indirizzi con pochissime lettere: un campione di ${nf(addrCache.length)} indirizzi può contenerne più o meno della media.`;
    status('e4-status', 'Simulazione completata.');
  }

  /* ------------------------------- E5 ------------------------------------- */
  async function e5() {
    status('e5-status', 'Calcolo…'); await tick();
    const T = 3000;
    const fns = [['SHA-256', sha256], ['Keccak-256', keccak256], ['SHA3-256', sha3_256]];
    const hd = fns.map(() => []), hd512 = [], cross = [];
    for (let t = 0; t < T; t++) {
      await breathe();
      const x = randomBytes(32), y = x.slice();
      const b = randInt(256); y[b >> 3] ^= 1 << (b & 7);
      fns.forEach(([, f], i) => hd[i].push(hamming(f(x), f(y))));
      cross.push(hamming(keccak256(x), sha3_256(x)));
    }
    const xs = [], ys = [];
    for (let t = 0; t < 500; t++) { const x = randomBytes(32), y = x.slice(); const b = randInt(256); y[b >> 3] ^= 1 << (b & 7); xs.push(sha512(x)); ys.push(sha512(y)); }
    const X = await Promise.all(xs), Y = await Promise.all(ys);
    X.forEach((h, i) => hd512.push(hamming(h, Y[i])));
    const lo = 100, hi = 156, step = 4, nb = (hi - lo) / step;
    const cats = [...Array(nb)].map((_, i) => lo + i * step);
    const hist = a => { const h = new Array(nb).fill(0); a.forEach(v => { const j = Math.floor((v - lo) / step); if (j >= 0 && j < nb) h[j]++; }); return h; };
    const pmf = binomPmf(256, 0.5);
    const exp = cats.map(c => { let s = 0; for (let k = c; k < c + step; k++) s += pmf[k]; return s * T; });
    const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
    Charts.bars('#e5-chart', {
      categories: cats, series: fns.map(([n], i) => ({ name: n, color: colors[i], values: hist(hd[i]) })), expected: exp,
      xLabel: 'bit di output cambiati (su 256) invertendo 1 bit dell’input', yLabel: 'prove', height: 220,
      tooltip: i => `<b>${cats[i]}–${cats[i] + step - 1} bit</b><br>` + fns.map(([n], j) => `${n}: ${hist(hd[j])[i]}`).join('<br>') + `<br>atteso (binomiale): ${nf(exp[i], 0)}`
    });
    const row = (n, a, bitsN) => { const [m, s] = meanSd(a); return `<tr><td>${n}</td><td class="num">${nf(m, 2)} ± ${nf(s, 2)}</td><td class="num">${nf(bitsN / 2)} ± ${nf(Math.sqrt(bitsN) / 2, 2)}</td><td class="num">${pct(m / bitsN)}</td></tr>`; };
    $('e5-table').innerHTML = `<table><thead><tr><th>Funzione</th><th class="num">Bit cambiati (media ± d.s.)</th><th class="num">Atteso per un oracolo casuale</th><th class="num">Frazione</th></tr></thead><tbody>
      ${fns.map(([n], i) => row(n, hd[i], 256)).join('')}
      ${row('SHA-512 (500 prove)', hd512, 512)}
      ${row('Keccak-256(x) vs SHA3-256(x), stesso input', cross, 256)}
    </tbody></table>`;
    status('e5-status', `${nf(T)} input casuali da 32 byte.`);
  }

  async function runAll() {
    try { await e1(); } catch (e) { status('e1-status', 'Errore: ' + e.message); }
    try { await e5(); } catch (e) { status('e5-status', 'Errore: ' + e.message); }
    await window.HW2.ready;
    try { await e3(); await e4(); } catch (e) { status('e3-status', 'Errore: ' + e.message); }
    try { await e2(); } catch (e) { status('e2-status', 'Errore: ' + e.message); }
  }
  $('e1-run').addEventListener('click', e1);
  $('e2-run').addEventListener('click', e2);
  $('e3-run').addEventListener('click', async () => { await e3(); await e4(); });
  $('e4-run').addEventListener('click', e4);
  $('e5-run').addEventListener('click', e5);
  let labKey = null;
  document.addEventListener('hw2-lab', () => {
    const lab = window.HW2.lab, key = lab.words.join(' ') + '|' + lab.pass;
    if (labKey !== null && key !== labKey && addrCache) {
      addrCache = null;
      $('e3-status').innerHTML = 'La frase del laboratorio è cambiata: premi "Esegui" per rifare E3 ed E4 con la nuova frase.';
    }
    labKey = key;
  });
  (window.HW2.ready || Promise.resolve()).then(() => { if (window.HW2.lab) runAll(); });
})();

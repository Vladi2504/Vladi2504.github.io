/* ==========================================================================
   ecc.js — Aritmetica su una curva ellittica "giocattolo"

        E :  y² = x³ + a·x + b   (mod p)

   Con a = 0, b = 7 è la stessa equazione di secp256k1 (la curva di Ethereum
   e Bitcoin), ma con un primo p minuscolo al posto di p ≈ 2^256.
   Scopo puramente didattico: NON usare per crittografia reale.

   I punti sono oggetti { x, y }; il punto all'infinito O (l'elemento neutro
   del gruppo) è rappresentato da null.
   ========================================================================== */
(function (root) {
  'use strict';

  const INF = null; // punto all'infinito O

  // Resto sempre non negativo (in JS -3 % 17 vale -3, a noi serve 14).
  function mod(a, p) {
    const r = a % p;
    return r < 0 ? r + p : r;
  }

  // Inverso moltiplicativo di a modulo p, con l'algoritmo di Euclide esteso.
  function modInv(a, p) {
    a = mod(a, p);
    if (a === 0) throw new Error('0 non è invertibile modulo ' + p);
    let r0 = p, r1 = a;   // resti
    let t0 = 0, t1 = 1;   // coefficienti di a
    while (r1 !== 0) {
      const q = Math.floor(r0 / r1);
      [r0, r1] = [r1, r0 - q * r1];
      [t0, t1] = [t1, t0 - q * t1];
    }
    return mod(t0, p);
  }

  function isPrime(n) {
    if (!Number.isInteger(n) || n < 2) return false;
    if (n % 2 === 0) return n === 2;
    for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
    return true;
  }

  // Definisce la curva. p < 2^26 garantisce che i prodotti restino interi esatti.
  function makeCurve(p, a, b) {
    if (!isPrime(p) || p <= 3) throw new Error('p deve essere un numero primo > 3');
    if (p >= 2 ** 26) throw new Error('p troppo grande per questa versione giocattolo');
    a = mod(a, p); b = mod(b, p);
    // Curva non singolare: il discriminante 4a³ + 27b² non deve annullarsi mod p.
    if (mod(4 * mod(a * a, p) * a + 27 * mod(b * b, p), p) === 0) {
      throw new Error('curva singolare (4a³ + 27b² ≡ 0 mod p)');
    }
    return { p, a, b };
  }

  function isOnCurve(C, P) {
    if (P === INF) return true;
    const { p, a, b } = C;
    const lhs = mod(P.y * P.y, p);
    const rhs = mod(mod(mod(P.x * P.x, p) * P.x, p) + a * P.x + b, p);
    return lhs === rhs;
  }

  function samePoint(P, Q) {
    if (P === INF || Q === INF) return P === Q;
    return P.x === Q.x && P.y === Q.y;
  }

  function negate(C, P) {
    return P === INF ? INF : { x: P.x, y: mod(-P.y, C.p) };
  }

  /* ------------------------------------------------------------------------
     ADDIZIONE DI PUNTI (regola della corda e della tangente)

     P + Q:  si traccia la retta per P e Q (la tangente se P = Q), che taglia
     la curva in un terzo punto −R; il risultato R è il suo simmetrico.

       pendenza   λ = (y₂ − y₁) / (x₂ − x₁)      se P ≠ Q   (corda)
                  λ = (3x₁² + a) / (2y₁)         se P = Q   (tangente)
       x₃ = λ² − x₁ − x₂
       y₃ = λ·(x₁ − x₃) − y₁                     (tutto mod p)

     Se si passa un oggetto `info`, viene riempito con i valori intermedi
     (usati per stampare i passaggi e per l'animazione).
     ------------------------------------------------------------------------ */
  function pointAdd(C, P, Q, info) {
    if (P === INF) { if (info) info.kind = 'identity'; return Q; }
    if (Q === INF) { if (info) info.kind = 'identity'; return P; }
    const { p, a } = C;

    // P + (−P) = O  (retta verticale; comprende il raddoppio di un punto con y = 0)
    if (P.x === Q.x && mod(P.y + Q.y, p) === 0) {
      if (info) info.kind = 'inverse';
      return INF;
    }

    let lambda, num, den;
    if (P.x === Q.x && P.y === Q.y) {            // raddoppio: tangente
      num = mod(3 * mod(P.x * P.x, p) + a, p);
      den = mod(2 * P.y, p);
    } else {                                      // addizione: corda
      num = mod(Q.y - P.y, p);
      den = mod(Q.x - P.x, p);
    }
    const inv = modInv(den, p);
    lambda = mod(num * inv, p);

    const x3 = mod(lambda * lambda - P.x - Q.x, p);
    const y3 = mod(lambda * (P.x - x3) - P.y, p);

    if (info) {
      info.kind = samePoint(P, Q) ? 'double' : 'add';
      Object.assign(info, { num, den, inv, lambda, x3, y3, third: { x: x3, y: mod(-y3, p) } });
    }
    return { x: x3, y: y3 };
  }

  /* ------------------------------------------------------------------------
     METODO 1 — addizioni ripetute:  G, 2G = G + G, 3G = 2G + G, …, kG
     Costo: k − 1 addizioni (lineare in k). Restituisce l'elenco dei multipli.
     ------------------------------------------------------------------------ */
  function multiplesOf(C, G, k) {
    const list = [{ k: 1, P: G, info: null }];
    let R = G;
    for (let i = 2; i <= k; i++) {
      const info = {};
      R = pointAdd(C, R, G, info);
      list.push({ k: i, P: R, info });
    }
    return list;
  }

  /* ------------------------------------------------------------------------
     METODO 2 — double-and-add (metodo veloce), da sinistra a destra sui bit di k.
     Si parte da R = G (bit più significativo); per ogni bit successivo:
       R ← 2R          sempre
       R ← R + G       solo se il bit vale 1
     Costo: circa log₂(k) raddoppi + (numero di bit a 1) addizioni.
     `onStep` (facoltativo) riceve ogni operazione eseguita.
     ------------------------------------------------------------------------ */
  function scalarMult(C, k, G, onStep) {
    if (!Number.isSafeInteger(k) || k < 1) throw new Error('k deve essere un intero positivo');
    if (G === INF) return INF;
    const bits = k.toString(2);
    let R = G;
    let acc = 1; // R = acc · G
    if (onStep) onStep({ bitIndex: 0, bit: '1', op: 'start', before: INF, after: R, acc, info: { kind: 'start' } });
    for (let i = 1; i < bits.length; i++) {
      let info = {};
      let before = R;
      R = pointAdd(C, R, R, info);
      acc *= 2;
      if (onStep) onStep({ bitIndex: i, bit: bits[i], op: 'double', before, after: R, acc, info });
      if (bits[i] === '1') {
        info = {};
        before = R;
        R = pointAdd(C, R, G, info);
        acc += 1;
        if (onStep) onStep({ bitIndex: i, bit: bits[i], op: 'add', before, after: R, acc, info });
      }
    }
    return R;
  }

  /* ------------------------------------------------------------------------
     Funzioni di supporto per l'esplorazione (solo per p piccoli)
     ------------------------------------------------------------------------ */

  // Tutti i punti affini della curva, ordinati per x e poi per y.
  function allPoints(C) {
    const { p, a, b } = C;
    const roots = new Map(); // quadrato -> radici
    for (let y = 0; y < p; y++) {
      const s = mod(y * y, p);
      if (!roots.has(s)) roots.set(s, []);
      roots.get(s).push(y);
    }
    const pts = [];
    for (let x = 0; x < p; x++) {
      const rhs = mod(mod(mod(x * x, p) * x, p) + a * x + b, p);
      const ys = roots.get(rhs);
      if (ys) for (const y of ys) pts.push({ x, y });
    }
    return pts;
  }

  // Numero di punti #E(F_p), compreso O (conteggio diretto, tabella dei quadrati).
  function countPoints(C) {
    const { p, a, b } = C;
    const sq = new Uint8Array(p);
    for (let y = 0; y < p; y++) sq[mod(y * y, p)]++;
    let n = 1; // O
    for (let x = 0; x < p; x++) n += sq[mod(mod(mod(x * x, p) * x, p) + a * x + b, p)];
    return n;
  }

  // Ordine di P: il più piccolo n > 0 con nP = O (aggiungendo P fino a tornare a O).
  function pointOrder(C, P, limit) {
    if (P === INF) return 1;
    let R = P, n = 1;
    const max = limit || 4 * C.p + 10;
    while (R !== INF) {
      R = pointAdd(C, R, P);
      n++;
      if (n > max) throw new Error('ordine non trovato');
    }
    return n;
  }

  function fmt(P) {
    return P === INF ? 'O' : '(' + P.x + ', ' + P.y + ')';
  }

  const ECC = {
    INF, mod, modInv, isPrime, makeCurve, isOnCurve, samePoint, negate,
    pointAdd, multiplesOf, scalarMult, allPoints, countPoints, pointOrder, fmt
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ECC;
  root.ECC = ECC;
})(typeof window !== 'undefined' ? window : globalThis);

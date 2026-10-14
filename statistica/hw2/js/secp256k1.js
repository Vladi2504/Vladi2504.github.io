/* ==========================================================================
   secp256k1.js — y² = x³ + 7 (mod p), p = 2^256 − 2^32 − 977, con BigInt.

   Rispetto all'HW1 (coordinate affini, un inverso modulare per ogni passo)
   qui si usano coordinate Jacobiane e una tabella precalcolata dei punti
   2^i·G: k·G diventa una somma di ~128 punti della tabella, senza raddoppi,
   con un solo inverso finale. Serve per derivare centinaia di indirizzi
   nelle statistiche in tempi ragionevoli.

   Solo uso didattico: NON a tempo costante. Mai usarlo con chiavi reali.
   ========================================================================== */
(function (root) {
  'use strict';

  const P = 2n ** 256n - 2n ** 32n - 977n;
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const G = {
    x: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
    y: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n
  };
  const mod = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
  function inv(a, m = P) {
    let r0 = m, r1 = mod(a, m), t0 = 0n, t1 = 1n;
    while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [t0, t1] = [t1, t0 - q * t1]; }
    return mod(t0, m);
  }

  // --- coordinate affini (per la tabella e per le somme di punti) ---
  function addAffine(A, B) {
    if (A === null) return B;
    if (B === null) return A;
    if (A.x === B.x && mod(A.y + B.y) === 0n) return null;
    const l = (A.x === B.x && A.y === B.y)
      ? mod(3n * A.x * A.x * inv(2n * A.y))
      : mod((B.y - A.y) * inv(B.x - A.x));
    const x = mod(l * l - A.x - B.x);
    return { x, y: mod(l * (A.x - x) - A.y) };
  }

  // Tabella T[i] = 2^i · G (256 raddoppi, calcolata una sola volta)
  const T = [G];
  for (let i = 1; i < 256; i++) T.push(addAffine(T[i - 1], T[i - 1]));

  // --- coordinate Jacobiane: (X, Y, Z) rappresenta (X/Z², Y/Z³) ---
  function jDouble(X, Y, Z) {
    if (Y === 0n) return null;
    const A = mod(X * X), Bq = mod(Y * Y), Cq = mod(Bq * Bq);
    const D = mod(2n * (mod((X + Bq) * (X + Bq)) - A - Cq));
    const E = 3n * A, F = mod(E * E);
    const X3 = mod(F - 2n * D);
    return [X3, mod(E * (D - X3) - 8n * Cq), mod(2n * Y * Z)];
  }
  // somma "mista": J (Jacobiano) + Q (affine)
  function jAddAffine(J, Q) {
    if (J === null) return [Q.x, Q.y, 1n];
    const [X1, Y1, Z1] = J;
    const Z1Z1 = mod(Z1 * Z1);
    const U2 = mod(Q.x * Z1Z1), S2 = mod(Q.y * Z1 * Z1Z1);
    const H = mod(U2 - X1), r = mod(2n * (S2 - Y1));
    if (H === 0n) return r === 0n ? jDouble(X1, Y1, Z1) : null;
    const HH = mod(H * H), I = 4n * HH, Jv = mod(H * I), V = mod(X1 * I);
    const X3 = mod(r * r - Jv - 2n * V);
    const Y3 = mod(r * (V - X3) - 2n * Y1 * Jv);
    const Z3 = mod((Z1 + H) * (Z1 + H) - Z1Z1 - HH);
    return [X3, Y3, Z3];
  }
  function toAffine(J) {
    if (J === null) return null;
    const zi = inv(J[2]), zi2 = mod(zi * zi);
    return { x: mod(J[0] * zi2), y: mod(J[1] * zi2 * zi) };
  }

  // k·G con la tabella precalcolata
  function mulG(k) {
    k = mod(k, N);
    if (k === 0n) return null;
    let J = null;
    for (let i = 0; i < 256 && k > 0n; i++, k >>= 1n) if (k & 1n) J = jAddAffine(J, T[i]);
    return toAffine(J);
  }

  const hex32 = v => v.toString(16).padStart(64, '0');
  // Formato SEC1: compresso (02/03 || x) e non compresso (04 || x || y)
  function compressed(Q) {
    const out = new Uint8Array(33);
    out[0] = Q.y & 1n ? 3 : 2;
    out.set(root.Prim.fromHex(hex32(Q.x)), 1);
    return out;
  }
  function rawXY(Q) { return root.Prim.fromHex(hex32(Q.x) + hex32(Q.y)); }

  root.Secp = { P, N, G, mod, inv, add: addAffine, mulG, compressed, rawXY, hex32 };
})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================================
   secp256k1.js — la stessa idea della curva giocattolo, ma sulla curva vera
   di Ethereum, con BigInt:  y² = x³ + 7  (mod p),  p = 2^256 − 2^32 − 977.

   Solo per illustrazione: implementazione NON a tempo costante e non
   protetta da attacchi side-channel. Non usarla mai con chiavi reali.
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
    while (r1 !== 0n) {
      const q = r0 / r1;
      [r0, r1] = [r1, r0 - q * r1];
      [t0, t1] = [t1, t0 - q * t1];
    }
    return mod(t0, m);
  }

  // Stesse formule di ecc.js: corda / tangente (a = 0).
  function add(A, B) {
    if (A === null) return B;
    if (B === null) return A;
    if (A.x === B.x && mod(A.y + B.y) === 0n) return null;
    const lambda = (A.x === B.x && A.y === B.y)
      ? mod(3n * A.x * A.x * inv(2n * A.y))
      : mod((B.y - A.y) * inv(B.x - A.x));
    const x = mod(lambda * lambda - A.x - B.x);
    const y = mod(lambda * (A.x - x) - A.y);
    return { x, y };
  }

  // Double-and-add sui 256 bit di k.
  function multiply(k, Pt = G) {
    let R = null;
    for (const bit of k.toString(2)) {
      R = add(R, R);
      if (bit === '1') R = add(R, Pt);
    }
    return R;
  }

  const hex32 = v => v.toString(16).padStart(64, '0');

  // Chiave privata (hex) → chiave pubblica e indirizzo Ethereum.
  function derive(privHex) {
    const clean = privHex.trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{1,64}$/.test(clean)) throw new Error('inserisci al massimo 64 cifre esadecimali');
    const k = BigInt('0x' + clean);
    if (k <= 0n || k >= N) throw new Error('la chiave deve essere compresa tra 1 e n − 1');
    const Q = multiply(k);
    const pubXY = hex32(Q.x) + hex32(Q.y);
    const H = root.Hashes;
    const hash = H.toHex(H.keccak256(H.fromHex(pubXY)));
    const addrLower = hash.slice(-40);
    // EIP-55: maiuscole dove la cifra corrispondente di keccak(indirizzo) è ≥ 8
    const h2 = H.toHex(H.keccak256(H.utf8(addrLower)));
    let addr = '0x';
    for (let i = 0; i < 40; i++) addr += parseInt(h2[i], 16) >= 8 ? addrLower[i].toUpperCase() : addrLower[i];
    return {
      k: hex32(k),
      x: hex32(Q.x),
      y: hex32(Q.y),
      uncompressed: '04' + pubXY,
      compressed: (Q.y % 2n === 0n ? '02' : '03') + hex32(Q.x),
      keccak: hash,
      address: addr
    };
  }

  function randomPrivateKey() {
    const b = new Uint8Array(32);
    let k;
    do {
      crypto.getRandomValues(b);
      k = BigInt('0x' + root.Hashes.toHex(b));
    } while (k === 0n || k >= N);
    return hex32(k);
  }

  root.Secp256k1 = { P, N, G, add, multiply, derive, randomPrivateKey };
})(typeof window !== 'undefined' ? window : globalThis);

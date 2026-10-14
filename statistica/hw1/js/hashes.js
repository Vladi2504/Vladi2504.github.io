/* ==========================================================================
   hashes.js — SHA-256 e Keccak-256 sincroni, senza dipendenze.
   - SHA-256 serve come termine di confronto nell'esplorazione statistica
     (effetto valanga di una vera funzione hash).
   - Keccak-256 serve nella sezione bonus per ricavare l'indirizzo Ethereum
     dalla chiave pubblica (Ethereum usa Keccak-256 "originale", non SHA3-256).
   ========================================================================== */
(function (root) {
  'use strict';

  /* ----------------------------- SHA-256 --------------------------------- */
  // Costanti: primi 32 bit della parte frazionaria di √ e ∛ dei primi numeri primi.
  const K = [], H0 = [];
  (function () {
    const isP = m => { for (let d = 2; d * d <= m; d++) if (m % d === 0) return false; return true; };
    const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    for (let n = 2; K.length < 64; n++) {
      if (!isP(n)) continue;
      if (H0.length < 8) H0.push(frac(Math.sqrt(n)));
      K.push(frac(Math.cbrt(n)));
    }
  })();
  const ror = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(msg) {
    const len = msg.length;
    const buf = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    buf.set(msg);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    const bitLen = len * 8;
    dv.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000));
    dv.setUint32(buf.length - 4, bitLen >>> 0);

    const H = H0.slice();
    const W = new Uint32Array(64);
    for (let off = 0; off < buf.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + 4 * i);
      for (let i = 16; i < 64; i++) {
        const a = W[i - 15], b = W[i - 2];
        const s0 = ror(a, 7) ^ ror(a, 18) ^ (a >>> 3);
        const s1 = ror(b, 17) ^ ror(b, 19) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    H.forEach((v, i) => odv.setUint32(4 * i, v >>> 0));
    return out;
  }

  /* ---------------------------- Keccak-256 -------------------------------- */
  const MASK = (1n << 64n) - 1n;
  // Costanti di round generate con l'LFSR della specifica (evita errori di battitura).
  const RC = [];
  (function () {
    const s = [1];
    let R = 1;
    for (let t = 1; t < 7 * 24; t++) {
      R <<= 1;
      if (R & 0x100) R ^= 0x171;
      s.push(R & 1);
    }
    for (let ir = 0; ir < 24; ir++) {
      let rc = 0n;
      for (let j = 0; j < 7; j++) if (s[j + 7 * ir]) rc |= 1n << BigInt((1 << j) - 1);
      RC.push(rc);
    }
  })();
  // Offset di rotazione r[x][y], anch'essi generati come nella specifica.
  const ROT = [...Array(5)].map(() => Array(5).fill(0));
  (function () {
    let x = 1, y = 0;
    for (let t = 0; t < 24; t++) {
      ROT[x][y] = ((t + 1) * (t + 2) / 2) % 64;
      [x, y] = [y, (2 * x + 3 * y) % 5];
    }
  })();
  const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);

  function keccakF(A) {
    for (let round = 0; round < 24; round++) {
      const C = [0, 1, 2, 3, 4].map(x => A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]);
      for (let x = 0; x < 5; x++) {
        const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
        for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
      }
      const B = new Array(25);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x][y]);
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
        }
      }
      A[0] ^= RC[round];
    }
  }

  function keccak256(msg) {
    const rate = 136;
    const padded = new Uint8Array(Math.ceil((msg.length + 1) / rate) * rate);
    padded.set(msg);
    padded[msg.length] ^= 0x01;          // padding di Keccak originale (SHA3 userebbe 0x06)
    padded[padded.length - 1] ^= 0x80;
    const A = new Array(25).fill(0n);
    for (let off = 0; off < padded.length; off += rate) {
      for (let i = 0; i < rate / 8; i++) {
        let lane = 0n;
        for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + 8 * i + j]);
        A[i] ^= lane;
      }
      keccakF(A);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) {
      let lane = A[i];
      for (let j = 0; j < 8; j++) { out[8 * i + j] = Number(lane & 0xffn); lane >>= 8n; }
    }
    return out;
  }

  /* ------------------------------ utilità --------------------------------- */
  const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  function fromHex(hex) {
    hex = hex.replace(/^0x/i, '');
    if (hex.length % 2) hex = '0' + hex;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(2 * i, 2), 16);
    return out;
  }
  const utf8 = s => new TextEncoder().encode(s);

  root.Hashes = { sha256, keccak256, toHex, fromHex, utf8 };
})(typeof window !== 'undefined' ? window : globalThis);

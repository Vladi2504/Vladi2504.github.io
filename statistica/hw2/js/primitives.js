/* ==========================================================================
   primitives.js — primitive crittografiche usate nella pipeline del wallet.

   Sincrone (implementate qui):      SHA-256, Keccak-256, SHA3-256, Base58Check
   Asincrone (Web Crypto del browser): SHA-512, HMAC-SHA512, PBKDF2-HMAC-SHA512

   Keccak-256 e SHA3-256 condividono la stessa permutazione Keccak-f[1600]:
   l'unica differenza è il byte di padding / separazione di dominio
   (0x01 per Keccak "originale", usato da Ethereum; 0x06 per SHA-3 FIPS 202).
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------ utilità --------------------------------- */
  const utf8 = s => new TextEncoder().encode(s);
  const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  function fromHex(h) {
    h = h.replace(/^0x/i, '');
    if (h.length % 2) h = '0' + h;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 * i, 2), 16);
    return out;
  }
  function concat(...parts) {
    const arrs = parts.map(p => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  const bytesToBig = b => (b.length ? BigInt('0x' + toHex(b)) : 0n);
  function bigToBytes(v, len) {
    const h = v.toString(16).padStart(len * 2, '0');
    return fromHex(h.slice(-len * 2));
  }
  const ser32 = i => Uint8Array.of((i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255);
  const bits = b => Array.from(b, x => x.toString(2).padStart(8, '0')).join('');
  function popcount8(x) { x = x - ((x >> 1) & 0x55); x = (x & 0x33) + ((x >> 2) & 0x33); return (x + (x >> 4)) & 0x0f; }
  // Distanza di Hamming tra due array di byte della stessa lunghezza
  function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += popcount8(a[i] ^ b[i]); return d; }
  function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }

  /* ------------------------------ SHA-256 --------------------------------- */
  const K256 = [], H256 = [];
  (function () {
    const isP = m => { for (let d = 2; d * d <= m; d++) if (m % d === 0) return false; return true; };
    const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    for (let n = 2; K256.length < 64; n++) {
      if (!isP(n)) continue;
      if (H256.length < 8) H256.push(frac(Math.sqrt(n)));
      K256.push(frac(Math.cbrt(n)));
    }
  })();
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  function sha256(msg) {
    const len = msg.length;
    const buf = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    buf.set(msg);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor((len * 8) / 0x100000000));
    dv.setUint32(buf.length - 4, (len * 8) >>> 0);
    const H = H256.slice();
    const W = new Uint32Array(64);
    for (let off = 0; off < buf.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + 4 * i);
      for (let i = 16; i < 64; i++) {
        const a = W[i - 15], b = W[i - 2];
        W[i] = (W[i - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + W[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    H.forEach((v, i) => odv.setUint32(4 * i, v >>> 0));
    return out;
  }

  /* --------------------- Keccak-f[1600] su lane a 32 bit ------------------- */
  // Ogni lane a 64 bit è memorizzata come (lo, hi) in un Uint32Array di 50 elementi.
  const RC_LO = new Uint32Array(24), RC_HI = new Uint32Array(24);
  (function () {
    const s = [1];
    let R = 1;
    for (let t = 1; t < 7 * 24; t++) { R <<= 1; if (R & 0x100) R ^= 0x171; s.push(R & 1); }
    for (let ir = 0; ir < 24; ir++) {
      let lo = 0, hi = 0;
      for (let j = 0; j < 7; j++) {
        if (!s[j + 7 * ir]) continue;
        const pos = (1 << j) - 1;
        if (pos < 32) lo = (lo | (1 << pos)) >>> 0; else hi = (hi | (1 << (pos - 32))) >>> 0;
      }
      RC_LO[ir] = lo; RC_HI[ir] = hi;
    }
  })();
  const ROT = [...Array(5)].map(() => Array(5).fill(0));
  (function () {
    let x = 1, y = 0;
    for (let t = 0; t < 24; t++) { ROT[x][y] = ((t + 1) * (t + 2) / 2) % 64; [x, y] = [y, (2 * x + 3 * y) % 5]; }
  })();
  const PI_DEST = [], ROT_N = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) { PI_DEST[x + 5 * y] = y + 5 * ((2 * x + 3 * y) % 5); ROT_N[x + 5 * y] = ROT[x][y]; }

  const C = new Uint32Array(10), B = new Uint32Array(50);
  function keccakF(s) {
    for (let r = 0; r < 24; r++) {
      for (let x = 0; x < 5; x++) {
        C[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
        C[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
      }
      for (let x = 0; x < 5; x++) {
        const x1 = (x + 1) % 5, x4 = (x + 4) % 5;
        const lo1 = C[2 * x1], hi1 = C[2 * x1 + 1];
        const dLo = C[2 * x4] ^ ((lo1 << 1) | (hi1 >>> 31));
        const dHi = C[2 * x4 + 1] ^ ((hi1 << 1) | (lo1 >>> 31));
        for (let y = 0; y < 25; y += 5) { s[2 * (x + y)] ^= dLo; s[2 * (x + y) + 1] ^= dHi; }
      }
      for (let i = 0; i < 25; i++) {
        const n = ROT_N[i], lo = s[2 * i], hi = s[2 * i + 1];
        let rl, rh;
        if (n === 0) { rl = lo; rh = hi; }
        else if (n < 32) { rl = (lo << n) | (hi >>> (32 - n)); rh = (hi << n) | (lo >>> (32 - n)); }
        else if (n === 32) { rl = hi; rh = lo; }
        else { const m = n - 32; rl = (hi << m) | (lo >>> (32 - m)); rh = (lo << m) | (hi >>> (32 - m)); }
        const d = PI_DEST[i];
        B[2 * d] = rl; B[2 * d + 1] = rh;
      }
      for (let y = 0; y < 25; y += 5) {
        for (let x = 0; x < 5; x++) {
          const i = x + y, i1 = ((x + 1) % 5) + y, i2 = ((x + 2) % 5) + y;
          s[2 * i] = B[2 * i] ^ (~B[2 * i1] & B[2 * i2]);
          s[2 * i + 1] = B[2 * i + 1] ^ (~B[2 * i1 + 1] & B[2 * i2 + 1]);
        }
      }
      s[0] ^= RC_LO[r]; s[1] ^= RC_HI[r];
    }
  }

  // Spugna Keccak con output di 256 bit (rate 136 byte). domain: 0x01 Keccak, 0x06 SHA-3.
  function keccakSponge256(msg, domain) {
    const rate = 136;
    const blocks = Math.floor(msg.length / rate) + 1;
    const padded = new Uint8Array(blocks * rate);
    padded.set(msg);
    padded[msg.length] ^= domain;
    padded[padded.length - 1] ^= 0x80;
    const s = new Uint32Array(50);
    for (let off = 0; off < padded.length; off += rate) {
      for (let i = 0; i < rate / 4; i++) {
        const j = off + 4 * i;
        s[i] ^= padded[j] | (padded[j + 1] << 8) | (padded[j + 2] << 16) | (padded[j + 3] << 24);
      }
      keccakF(s);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      const w = s[i];
      out[4 * i] = w & 255; out[4 * i + 1] = (w >>> 8) & 255; out[4 * i + 2] = (w >>> 16) & 255; out[4 * i + 3] = (w >>> 24) & 255;
    }
    return out;
  }
  const keccak256 = msg => keccakSponge256(msg, 0x01);
  const sha3_256 = msg => keccakSponge256(msg, 0x06);

  /* -------------------- Web Crypto: SHA-512, HMAC, PBKDF2 ------------------ */
  const subtle = (root.crypto && root.crypto.subtle) || null;
  function needSubtle() {
    if (!subtle) throw new Error('Web Crypto non disponibile: apri la pagina via https (es. GitHub Pages) o da localhost');
  }
  async function sha512(msg) {
    needSubtle();
    return new Uint8Array(await subtle.digest('SHA-512', msg));
  }
  async function hmacSha512(key, data) {
    needSubtle();
    const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', k, data));
  }
  async function pbkdf2Sha512(password, salt, iterations, bytes) {
    needSubtle();
    const k = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations }, k, bytes * 8));
  }

  /* ------------------------------ Base58Check ------------------------------ */
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58(bytes) {
    let v = bytesToBig(bytes), s = '';
    while (v > 0n) { s = B58[Number(v % 58n)] + s; v /= 58n; }
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) s = '1' + s;
    return s;
  }
  const base58check = payload => base58(concat(payload, sha256(sha256(payload)).slice(0, 4)));

  root.Prim = {
    utf8, toHex, fromHex, concat, bytesToBig, bigToBytes, ser32, bits, hamming, popcount8, randomBytes,
    sha256, keccak256, sha3_256, sha512, hmacSha512, pbkdf2Sha512, base58, base58check
  };
})(typeof window !== 'undefined' ? window : globalThis);

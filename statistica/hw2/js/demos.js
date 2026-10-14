/* ==========================================================================
   demos.js — piccoli esperimenti a supporto della discussione:
   1. perché esistono gli indici "hardened" (BIP-32): xpub + una chiave figlia
      non-hardened rivelano la chiave privata del genitore;
   2. verifica di un indirizzo con checksum EIP-55;
   3. confronto SHA-256 / SHA-512 / Keccak-256 / SHA3-256 sullo stesso input.
   ========================================================================== */
(function () {
  'use strict';
  const { toHex, utf8, concat, ser32, bytesToBig, hmacSha512, sha256, sha512, keccak256, sha3_256, hamming } = window.Prim;
  const W = window.Wallet, S = window.Secp;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (h, n = 10) => h.slice(0, n) + '…' + h.slice(-n);

  /* ------------------- 1. attacco xpub + chiave figlia -------------------- */
  async function xpubAttack() {
    const out = $('xpub-out');
    const lab = window.HW2 && window.HW2.lab;
    if (!lab) { out.innerHTML = 'Esegui prima il laboratorio (sezione 2).'; return; }
    const m = lab.master;
    // Nodo A = m/44'/60'/0'/0: la sua chiave pubblica estesa (K, c) è ciò che espone un wallet "watch-only".
    const A = await W.derivePath(m, "m/44'/60'/0'/0");
    const xpub = { K: S.mulG(A.k), c: A.c };
    // Fuga: la chiave privata del primo indirizzo m/44'/60'/0'/0/0 (non-hardened).
    const child = await W.ckdPriv(A, 0);
    // L'attaccante ricalcola IL usando solo dati pubblici…
    const I = await hmacSha512(xpub.c, concat(S.compressed(xpub.K), ser32(0)));
    const IL = bytesToBig(I.slice(0, 32));
    // …e ricava la chiave privata del genitore: k_A = k_0 − IL (mod n)
    const kA = S.mod(child.k - IL, S.N);
    const Q = S.mulG(kA);
    const match = Q.x === xpub.K.x && Q.y === xpub.K.y;
    const rows = [];
    for (let i = 1; i <= 3; i++) {
      const stolen = await W.ckdPriv({ k: kA, c: xpub.c, depth: 4, path: 'A' }, i);
      const real = await W.derivePath(m, `m/44'/60'/0'/0/${i}`);
      const ad = W.keyToAddress(stolen.k).address;
      rows.push(`<tr><td class="mono">…/0/${i}</td><td class="mono">${ad}</td><td>${stolen.k === real.k ? '<span class="yes">sì</span>' : '<span class="no">no</span>'}</td></tr>`);
    }
    out.innerHTML = `
      <div class="valbox"><span class="k">xpub di m/44'/60'/0'/0 (K, c)</span>${short(toHex(S.compressed(xpub.K)), 12)} · ${short(toHex(xpub.c), 12)}<br>
      <span class="k">chiave privata trapelata di …/0/0</span>${short(S.hex32(child.k), 12)}<br>
      <span class="k">IL = HMAC-SHA512(c, K ‖ 0)[0:32]</span>${short(S.hex32(IL), 12)}<br>
      <span class="k">k_genitore = k_figlio − IL mod n</span>${short(S.hex32(kA), 12)}</div>
      <p class="small">Controllo k_genitore·G = K del genitore: ${match ? '<span class="badge ok">vero, la chiave privata del genitore è stata ricostruita</span>' : '<span class="badge ko">falso</span>'}</p>
      <div class="table-wrap"><table><thead><tr><th>Indirizzo</th><th>Chiave ricavata dall'attaccante → indirizzo</th><th>È la chiave vera?</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
      <p class="small muted">Con un livello hardened (es. 0') l'HMAC usa la chiave privata del genitore invece di K, quindi l'attaccante non può calcolare IL.
      Per questo i primi tre livelli di BIP-44 (44'/60'/0') sono hardened: una fuga resta confinata all'account.</p>`;
  }

  /* ------------------------- 2. verifica EIP-55 --------------------------- */
  function checkEip55() {
    const v = $('eip-in').value;
    const r = W.validateAddress(v);
    const cls = r.status === 'ok' ? 'ok' : r.status === 'nochecksum' ? 'info' : 'ko';
    $('eip-out').innerHTML = `<span class="badge ${cls}">${esc(r.msg)}</span>` +
      (r.expected ? `<div class="small muted" style="margin-top:6px">Con quelle cifre la checksum corretta sarebbe <span class="mono">${r.expected}</span>,
        ma non è detto che le cifre siano giuste: l'errore va cercato nell'originale.</div>` : '');
  }
  function eipTypo() {
    const lab = window.HW2 && window.HW2.lab;
    const base = lab ? lab.address : '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
    const chars = base.slice(2).split('');
    const pos = Math.floor(Math.random() * 40);
    const hex = '0123456789abcdef';
    let c;
    do { c = hex[Math.floor(Math.random() * 16)]; } while (c === chars[pos].toLowerCase());
    chars[pos] = Math.random() < 0.5 ? c : c.toUpperCase();
    $('eip-in').value = '0x' + chars.join('');
    checkEip55();
    $('eip-out').insertAdjacentHTML('beforeend', `<div class="small muted" style="margin-top:4px">Ho cambiato il carattere in posizione ${pos + 1}.</div>`);
  }

  /* ------------------------ 3. confronto delle hash ------------------------ */
  async function compareHashes() {
    const txt = $('hash-in').value;
    const m = utf8(txt);
    const k = keccak256(m), s3 = sha3_256(m);
    const rows = [
      ['SHA-256', 'SHA-2 · Merkle–Damgård', toHex(sha256(m)), 'checksum della mnemonica (BIP-39)'],
      ['SHA-512', 'SHA-2 · Merkle–Damgård', toHex(await sha512(m)), 'dentro HMAC e PBKDF2 (BIP-39, BIP-32)'],
      ['Keccak-256', 'Keccak · spugna, padding 0x01', toHex(k), 'indirizzi Ethereum, EIP-55'],
      ['SHA3-256', 'Keccak · spugna, padding 0x06', toHex(s3), 'standard NIST FIPS 202 (non usato da Ethereum)']
    ];
    $('hash-out').innerHTML = `<table><thead><tr><th>Funzione</th><th>Famiglia</th><th>Digest (hex)</th><th>Nella pipeline</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td><b>${r[0]}</b></td><td class="small">${r[1]}</td><td class="mono" style="font-size:0.75rem">${r[2]}</td><td class="small">${r[3]}</td></tr>`).join('') +
      `</tbody></table>`;
    $('hash-obs').innerHTML = `Keccak-256 e SHA3-256 usano la stessa permutazione e la stessa capacità, ma i loro digest differiscono in
      <b>${hamming(k, s3)} bit su 256</b>, come due output indipendenti (in media 128). Basta cambiare il byte di padding da 0x01 a 0x06.
      Per questo, in Ethereum, "SHA3" nel codice Solidity (<code>sha3</code>, poi <code>keccak256</code>) indica Keccak-256 e non SHA3-256.`;
  }

  $('xpub-run').addEventListener('click', xpubAttack);
  $('eip-check').addEventListener('click', checkEip55);
  $('eip-in').addEventListener('keydown', e => { if (e.key === 'Enter') checkEip55(); });
  $('eip-typo').addEventListener('click', eipTypo);
  $('hash-run').addEventListener('click', compareHashes);
  $('hash-in').addEventListener('input', compareHashes);

  (window.HW2.ready || Promise.resolve()).then(() => {
    const lab = window.HW2.lab;
    $('eip-in').value = lab ? lab.address : '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
    checkEip55();
    xpubAttack();
  });
  compareHashes();
})();

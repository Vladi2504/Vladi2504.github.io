/* ==========================================================================
   lab.js — laboratorio interattivo: dalla frase mnemonica all'indirizzo
   con checksum, mostrando l'output di ogni passaggio della pipeline.
   ========================================================================== */
(function () {
  'use strict';
  const { toHex, bits, randomBytes, sha256 } = window.Prim;
  const W = window.Wallet, S = window.Secp;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PRESETS = {
    abandon: { label: 'Vettore di test BIP-39: "abandon … about"', phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' },
    hardhat: { label: 'Mnemonica di test di Hardhat/Foundry: "test … junk"', phrase: 'test test test test test test test test test test test junk' },
    rand12: { label: 'Nuova mnemonica casuale (12 parole, 128 bit)', bytes: 16 },
    rand24: { label: 'Nuova mnemonica casuale (24 parole, 256 bit)', bytes: 32 }
  };
  // Indirizzi di riferimento noti (passphrase vuota, percorso standard m/44'/60'/0'/0/i)
  const KNOWN = {
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about': {
      0: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', src: 'vettore di test diffuso tra le librerie Ethereum (ethers.js, MetaMask)' },
    'test test test test test test test test test test test junk': {
      0: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 1: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', src: 'primi account di sviluppo di Hardhat/Foundry' }
  };
  const SCHEMES = {
    std: { label: "MetaMask, Rabby, Rainbow, Exodus… · m/44'/60'/0'/0/i", path: i => `m/44'/60'/0'/0/${i}` },
    ledger: { label: "Ledger Live · m/44'/60'/i'/0/0", path: i => `m/44'/60'/${i}'/0/0` },
    legacy: { label: "Legacy MEW / Ledger (vecchio) · m/44'/60'/0'/i", path: i => `m/44'/60'/0'/${i}` }
  };
  const LEVEL_NAMES = ['purpose (BIP-44)', 'coin_type (60 = ETH)', 'account', 'change (0 = esterno)', 'address_index'];

  const ui = {
    preset: $('lab-preset'), phrase: $('lab-phrase'), pass: $('lab-pass'), scheme: $('lab-scheme'), idx: $('lab-idx'),
    run: $('lab-run'), mutate: $('lab-mutate'), status: $('lab-status'), out: $('lab-out'), accounts: $('lab-accounts'), wl: $('lab-wordlist')
  };

  const state = window.HW2 = window.HW2 || {};

  function short(h, n = 10) { return h.length > 2 * n + 1 ? h.slice(0, n) + '…' + h.slice(-n) : h; }
  function setStatus(msg, err) { ui.status.innerHTML = msg; ui.status.style.color = err ? 'var(--bad)' : ''; }

  function applyPreset() {
    const p = PRESETS[ui.preset.value];
    if (!p) return;
    if (p.phrase) ui.phrase.value = p.phrase;
    else ui.phrase.value = W.entropyToMnemonic(randomBytes(p.bytes)).words.join(' ');
  }

  function card(title, chips, std, body) {
    return `<article class="stage-card"><header><h4>${title}</h4><div class="chips">${chips.map(c =>
      `<span class="chip ${c[0]}">${c[1]}</span>`).join('')}</div><span class="std">${std}</span></header>${body}</article>`;
  }

  async function run() {
    ui.run.disabled = true;
    setStatus('Calcolo in corso…');
    try {
      const parsed = W.parseMnemonic(ui.phrase.value);
      if (!parsed.indices) { setStatus(esc(parsed.error), true); ui.run.disabled = false; return; }
      const pass = ui.pass.value;
      const scheme = SCHEMES[ui.scheme.value];
      const idx = Math.max(0, Math.min(1000, parseInt(ui.idx.value, 10) || 0));
      const path = scheme.path(idx);
      const html = [];

      // 1. entropia
      const ent = parsed.entropy;
      html.push(card('Entropia', [['gen', 'Generazione']], 'CSPRNG',
        `<p>L'unico passaggio casuale di tutta la pipeline. Un wallet nuovo genera ${parsed.ENT} bit con un generatore crittografico
        (qui <code>crypto.getRandomValues</code>). Per una frase già esistente l'entropia si ricava invertendo la codifica BIP-39.</p>
        <div class="valbox"><span class="k">${parsed.ENT} bit (hex)</span>${toHex(ent)}</div>`));

      // 2. mnemonica
      const total = parsed.groups.join('');
      const csStart = parsed.ENT;
      const wordsHtml = parsed.words.map((w, i) => {
        const g = parsed.groups[i];
        const from = i * 11, to = from + 11;
        let b = g;
        if (to > csStart) {
          const cut = Math.max(0, csStart - from);
          b = g.slice(0, cut) + '<mark>' + g.slice(cut) + '</mark>';
        }
        return `<div class="word"><span class="n">${i + 1} · indice ${parsed.indices[i]}</span><b>${esc(w)}</b><span class="b">${b}</span></div>`;
      }).join('');
      const checkBadge = parsed.ok
        ? `<span class="badge ok">checksum valida</span>`
        : `<span class="badge ko">checksum NON valida</span>`;
      html.push(card('Frase mnemonica', [['enc', 'Codifica'], ['cs', 'Checksum']], 'BIP-39',
        `<p>Ai ${parsed.ENT} bit di entropia si aggiungono ${parsed.CS} bit di checksum, i primi bit di SHA-256(entropia).
        I ${total.length} bit totali si dividono in ${parsed.words.length} gruppi da 11 bit, e ogni gruppo è l'indice (0–2047) di una parola.
        In evidenza i bit di checksum, che finiscono nell'ultima parola.</p>
        <div class="word-grid">${wordsHtml}</div>
        <div class="valbox"><span class="k">SHA-256(entropia)</span>${toHex(sha256(ent)).slice(0, 16)}…
        <span class="k" style="margin-left:10px">primi ${parsed.CS} bit</span>${parsed.expected}
        <span class="k" style="margin-left:10px">nella frase</span>${parsed.checksum}</div>${checkBadge}
        ${parsed.ok ? '' : '<p style="margin-top:8px">Un wallet rifiuterebbe questa frase. Il calcolo prosegue comunque, perché PBKDF2 non controlla la checksum.</p>'}`));

      // 3. seed
      const t0 = performance.now();
      const seed = await W.mnemonicToSeed(parsed.words, pass);
      const tSeed = performance.now() - t0;
      html.push(card('Seed', [['der', 'Derivazione']], 'BIP-39 · PBKDF2',
        `<p>seed = PBKDF2-HMAC-SHA512(password = frase, salt = "mnemonic" + passphrase, 2048 iterazioni, 64 byte).
        Le 2048 iterazioni rendono più costoso provare frasi a caso (<i>key stretching</i>); la passphrase opzionale cambia completamente il seed.
        Calcolato in ${tSeed.toFixed(1)} ms.</p>
        <div class="valbox"><span class="k">512 bit</span>${toHex(seed)}</div>`));

      // 4. chiave master
      const m = await W.masterKey(seed);
      const ser = W.serializeMaster(m);
      html.push(card('Chiave master', [['der', 'Derivazione']], 'BIP-32',
        `<p>I = HMAC-SHA512(chiave = "Bitcoin seed", seed). I primi 32 byte sono la chiave privata master, gli ultimi 32 il
        <i>chain code</i>, che serve a derivare i figli. La stringa "Bitcoin seed" viene dallo standard nato per Bitcoin
        ed è la stessa anche nei wallet Ethereum.</p>
        <div class="valbox"><span class="k">k master</span>${S.hex32(m.k)}<br><span class="k">chain code</span>${toHex(m.c)}</div>
        <div class="valbox"><span class="k">xprv (Base58Check)</span>${ser.xprv}</div>`));

      // 5. percorso BIP-44
      const nodes = [];
      const leaf = await W.derivePath(m, path, n => nodes.push(n));
      const segs = path.split('/').slice(1);
      const rows = nodes.map((n, i) => `<tr><td class="mono">${esc(segs[i])}</td><td>${LEVEL_NAMES[i] || ''}</td>
        <td>${n.hardened ? 'sì' : 'no'}</td><td class="mono">${short(S.hex32(n.k), 8)}</td></tr>`).join('');
      html.push(card('Percorso di derivazione', [['der', 'Derivazione']], 'BIP-32 / BIP-44',
        `<p>BIP-32 deriva una chiave figlia da (chiave genitore, chain code, indice) con un'altra HMAC-SHA512. BIP-44 fissa il significato
        dei livelli, così wallet diversi trovano gli stessi account. Percorso: <code>${esc(path)}</code>. Gli indici con l'apice sono
        <i>hardened</i> (≥ 2³¹) e usano la chiave privata del genitore nel calcolo.</p>
        <div class="table-wrap" style="margin:0"><table><thead><tr><th>Livello</th><th>Significato</th><th>Hardened</th><th>Chiave privata</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`));

      // 6–10. chiave privata → indirizzo
      const a = W.keyToAddress(leaf.k);
      html.push(card('Chiave privata dell\'account', [['der', 'Derivazione']], 'BIP-32',
        `<p>Un intero di 256 bit in [1, n−1]. È ciò che un wallet mostra con "Esporta chiave privata".</p>
        <div class="valbox"><span class="k">k</span>0x${S.hex32(leaf.k)}</div>`));
      html.push(card('Chiave pubblica', [['pk', 'Chiave pubblica']], 'secp256k1',
        `<p>K = k·G sulla curva y² = x³ + 7 (mod p), la stessa operazione dell'HW1 con numeri di 256 bit. Facile in avanti, impossibile
        da invertire. Servirà anche per verificare le firme ECDSA delle transazioni.</p>
        <div class="valbox"><span class="k">x</span>${S.hex32(a.pub.Q.x)}<br><span class="k">y</span>${S.hex32(a.pub.Q.y)}</div>
        <div class="valbox"><span class="k">compressa (33 B)</span>${toHex(a.pub.compressed)}</div>`));
      const hh = toHex(a.hash);
      html.push(card('Hash della chiave pubblica', [['hash', 'Hashing']], 'Keccak-256',
        `<p>Keccak-256 dei 64 byte x ‖ y, senza il prefisso 04. Si tengono gli ultimi 20 byte (in evidenza).</p>
        <div class="valbox"><span class="dim">${hh.slice(0, 24)}</span><mark>${hh.slice(24)}</mark></div>`));
      html.push(card('Indirizzo', [['enc', 'Codifica']], 'esadecimale',
        `<p>I 20 byte scritti in esadecimale con il prefisso 0x. È un cambio di rappresentazione, senza alcuna protezione dagli errori.</p>
        <div class="valbox">${a.lower}</div>`));
      const low = a.lower.slice(2), up = a.address.slice(2), nib = a.nibbles;
      let l1 = '', l2 = '', l3 = '';
      for (let i = 0; i < 40; i++) {
        const isL = /[a-f]/.test(low[i]);
        const big = parseInt(nib[i], 16) >= 8;
        l1 += low[i];
        l2 += isL ? `<span class="${big ? 'hi' : 'lo'}">${nib[i]}</span>` : `<span class="lo">·</span>`;
        l3 += isL && big ? `<span class="up">${up[i]}</span>` : up[i];
      }
      const letters = (low.match(/[a-f]/g) || []).length;
      html.push(card('Indirizzo con checksum', [['cs', 'Checksum'], ['enc', 'Codifica']], 'EIP-55',
        `<p>Si calcola Keccak-256 del testo dell'indirizzo in minuscolo. Ogni lettera a–f diventa maiuscola se la cifra corrispondente
        dell'hash è ≥ 8. Le ${letters} lettere portano ${letters} bit di controllo, senza cambiare l'indirizzo.</p>
        <div class="eip55"><span class="lbl">minuscolo</span>0x${l1}
<span class="lbl">keccak</span>  ${l2}
<span class="lbl">EIP-55</span>0x${l3}</div>`));

      ui.out.innerHTML = html.join('');

      // verifica con valori di riferimento
      const norm = parsed.words.join(' ');
      const ref = KNOWN[norm];
      let verdict = '';
      if (ref && !pass && ui.scheme.value === 'std' && ref[idx]) {
        verdict = ref[idx] === a.address
          ? `<span class="badge ok">coincide con l'indirizzo atteso</span> <span class="small muted">${ref[idx]} · ${ref.src}</span>`
          : `<span class="badge ko">diverso dall'atteso ${ref[idx]}</span>`;
      }
      setStatus(`<b>Indirizzo:</b> <span class="mono">${a.address}</span> ${verdict}`);
      state.lab = { words: parsed.words, pass, scheme: ui.scheme.value, master: m, seed, path, address: a.address };

      // primi 5 account con lo schema scelto
      const accRows = [];
      for (let i = 0; i < 5; i++) {
        const pth = scheme.path(i);
        const n = await W.derivePath(m, pth);
        const ad = W.keyToAddress(n.k).address;
        accRows.push(`<tr><td>Account ${i + 1}</td><td class="mono">${pth}</td><td class="mono">${ad}</td></tr>`);
      }
      ui.accounts.innerHTML = `<table><thead><tr><th>Wallet</th><th>Percorso</th><th>Indirizzo</th></tr></thead><tbody>${accRows.join('')}</tbody></table>`;
      document.dispatchEvent(new CustomEvent('hw2-lab'));
    } catch (e) {
      setStatus('Errore: ' + esc(e.message), true);
    }
    ui.run.disabled = false;
  }

  // Sostituisce una parola a caso: la checksum resta valida solo con probabilità 2^-CS.
  function mutate() {
    const words = ui.phrase.value.trim().split(/\s+/);
    const list = W.words;
    if (!words.length || !list) return;
    const pos = Math.floor(Math.random() * words.length);
    let w;
    do { w = list[Math.floor(Math.random() * 2048)]; } while (w === words[pos]);
    const old = words[pos];
    words[pos] = w;
    ui.phrase.value = words.join(' ');
    run().then(() => {
      const p = W.parseMnemonic(ui.phrase.value);
      const CS = p.CS || 4;
      ui.status.insertAdjacentHTML('afterbegin', `<span class="small">Parola ${pos + 1}: "${esc(old)}" → "${esc(w)}". ` +
        (p.ok ? `Per caso la checksum è ancora valida (succede con probabilità 1/${2 ** CS}).` : 'La checksum rileva l\'errore.') + '</span><br>');
    });
  }

  async function init() {
    ui.preset.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
    ui.scheme.innerHTML = Object.entries(SCHEMES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
    try {
      const info = await W.loadWordlist();
      ui.wl.innerHTML = info.verified
        ? `<span class="badge ok">lista BIP-39 verificata</span> SHA-256 = <span class="mono">${info.hash.slice(0, 16)}…</span>, identico a quello dello standard`
        : `<span class="badge ko">lista caricata ma con hash inatteso</span>`;
    } catch (e) {
      ui.wl.innerHTML = `<span class="badge ko">${esc(e.message)}</span>`;
      return;
    }
    applyPreset();
    ui.preset.addEventListener('change', () => { applyPreset(); run(); });
    ui.run.addEventListener('click', run);
    ui.mutate.addEventListener('click', mutate);
    ui.scheme.addEventListener('change', run);
    ui.idx.addEventListener('change', run);
    ui.pass.addEventListener('change', run);
    ui.phrase.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } });
    await run();
    document.dispatchEvent(new CustomEvent('hw2-ready'));
  }
  state.ready = init();
})();

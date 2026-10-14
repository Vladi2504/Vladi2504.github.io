/* ==========================================================================
   wallet.js — la pipeline di un wallet Ethereum, standard per standard.

     entropia ──BIP-39──► mnemonica ──BIP-39 (PBKDF2)──► seed
     seed ──BIP-32──► chiave master ──BIP-32/BIP-44 (m/44'/60'/0'/0/i)──► chiave privata
     chiave privata ──secp256k1──► chiave pubblica ──Keccak-256──► indirizzo ──EIP-55──► checksum

   Solo uso didattico: non inserire mai una frase mnemonica reale.
   ========================================================================== */
(function (root) {
  'use strict';
  const { utf8, toHex, fromHex, concat, bytesToBig, bigToBytes, ser32, sha256, keccak256,
    hmacSha512, pbkdf2Sha512, base58check } = root.Prim;
  const S = root.Secp;

  /* ------------------------------- BIP-39 --------------------------------- */
  // Lista ufficiale di 2048 parole inglesi (dal pacchetto npm "bip39"), verificata con SHA-256.
  const WORDLIST_URLS = [
    'https://cdn.jsdelivr.net/npm/bip39@3.1.0/src/wordlists/english.json',
    'https://unpkg.com/bip39@3.1.0/src/wordlists/english.json'
  ];
  const WORDLIST_SHA256 = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda'; // sha256 di english.txt
  let WORDS = null, INDEX = null, wordlistInfo = null;

  async function loadWordlist() {
    if (WORDS) return wordlistInfo;
    let lastErr;
    for (const url of WORDLIST_URLS) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const list = await r.json();
        if (!Array.isArray(list) || list.length !== 2048) throw new Error('lista non valida');
        const hash = toHex(sha256(utf8(list.join('\n') + '\n')));
        WORDS = list;
        INDEX = new Map(list.map((w, i) => [w, i]));
        wordlistInfo = { url, hash, verified: hash === WORDLIST_SHA256 };
        return wordlistInfo;
      } catch (e) { lastErr = e; }
    }
    throw new Error('impossibile caricare la lista di parole BIP-39 (' + (lastErr && lastErr.message) + ')');
  }

  const toBits = b => Array.from(b, x => x.toString(2).padStart(8, '0')).join('');

  // Entropia (16–32 byte) → mnemonica: entropia ‖ checksum, divisa in gruppi di 11 bit.
  function entropyToMnemonic(entropy) {
    const ENT = entropy.length * 8;
    if (ENT < 128 || ENT > 256 || ENT % 32) throw new Error('entropia di 128–256 bit, multipla di 32');
    const CS = ENT / 32;
    const checksum = toBits(sha256(entropy)).slice(0, CS);
    const all = toBits(entropy) + checksum;
    const groups = all.match(/.{11}/g);
    const indices = groups.map(g => parseInt(g, 2));
    return { words: indices.map(i => WORDS[i]), indices, groups, ENT, CS, checksum, entropy };
  }

  // Mnemonica → entropia + verifica della checksum.
  function parseMnemonic(phrase) {
    const words = phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      return { ok: false, words, error: `servono 12, 15, 18, 21 o 24 parole (trovate ${words.length})` };
    }
    const unknown = words.filter(w => !INDEX.has(w));
    if (unknown.length) return { ok: false, words, error: 'parole non presenti nella lista BIP-39: ' + unknown.join(', ') };
    const indices = words.map(w => INDEX.get(w));
    const groups = indices.map(i => i.toString(2).padStart(11, '0'));
    const all = groups.join('');
    const CS = all.length / 33, ENT = all.length - CS;
    const entBits = all.slice(0, ENT), checksum = all.slice(ENT);
    const entropy = new Uint8Array(ENT / 8);
    for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(entBits.substr(8 * i, 8), 2);
    const expected = toBits(sha256(entropy)).slice(0, CS);
    return { ok: checksum === expected, words, indices, groups, ENT, CS, checksum, expected, entropy,
      error: checksum === expected ? null : 'checksum non valida: la frase non è una mnemonica BIP-39 corretta' };
  }

  // Seed = PBKDF2-HMAC-SHA512(password = mnemonica, salt = "mnemonic" + passphrase, 2048 iterazioni, 64 byte)
  function mnemonicToSeed(words, passphrase = '') {
    const pw = utf8(words.join(' ').normalize('NFKD'));
    const salt = utf8(('mnemonic' + passphrase).normalize('NFKD'));
    return pbkdf2Sha512(pw, salt, 2048, 64);
  }

  /* ------------------------------- BIP-32 --------------------------------- */
  const HARD = 0x80000000;

  async function masterKey(seed) {
    const I = await hmacSha512(utf8('Bitcoin seed'), seed);
    const k = bytesToBig(I.slice(0, 32));
    if (k === 0n || k >= S.N) throw new Error('seed non valido (probabilità < 2^-127)');
    return { k, c: I.slice(32), depth: 0, index: 0, path: 'm' };
  }

  // Derivazione figlio da genitore privato (CKDpriv).
  async function ckdPriv(node, i) {
    const hardened = i >= HARD;
    const data = hardened
      ? concat([0], bigToBytes(node.k, 32), ser32(i))            // 0x00 ‖ k_par ‖ i
      : concat(S.compressed(S.mulG(node.k)), ser32(i));           // K_par compressa ‖ i
    const I = await hmacSha512(node.c, data);
    const IL = bytesToBig(I.slice(0, 32));
    const k = S.mod(IL + node.k, S.N);
    if (IL >= S.N || k === 0n) throw new Error('indice non valido, usare il successivo (probabilità < 2^-127)');
    const label = hardened ? (i - HARD) + "'" : String(i);
    return { k, c: I.slice(32), depth: node.depth + 1, index: i, IL, hardened, path: node.path + '/' + label };
  }

  // Derivazione figlio da genitore PUBBLICO (CKDpub): solo indici non-hardened.
  async function ckdPub(pubNode, i) {
    if (i >= HARD) throw new Error('dalla sola chiave pubblica non si possono derivare figli hardened');
    const I = await hmacSha512(pubNode.c, concat(S.compressed(pubNode.K), ser32(i)));
    const IL = bytesToBig(I.slice(0, 32));
    return { K: S.add(S.mulG(IL), pubNode.K), c: I.slice(32), IL };
  }

  function parsePath(path) {
    const parts = path.trim().split('/');
    if (parts[0] !== 'm') throw new Error('il percorso deve iniziare con m');
    return parts.slice(1).map(p => {
      const m = p.match(/^(\d+)(['hH]?)$/);
      if (!m) throw new Error('segmento non valido: ' + p);
      const n = Number(m[1]);
      if (n >= HARD) throw new Error('indice troppo grande: ' + p);
      return m[2] ? n + HARD : n;
    });
  }

  async function derivePath(master, path, onStep) {
    let node = master;
    for (const i of parsePath(path)) {
      node = await ckdPriv(node, i);
      if (onStep) onStep(node);
    }
    return node;
  }

  // Serializzazione della chiave master (profondità 0): xprv / xpub in Base58Check
  function serializeMaster(m) {
    const head = (ver) => concat(fromHex(ver), [0], [0, 0, 0, 0], [0, 0, 0, 0], m.c);
    return {
      xprv: base58check(concat(head('0488ade4'), [0], bigToBytes(m.k, 32))),
      xpub: base58check(concat(head('0488b21e'), S.compressed(S.mulG(m.k))))
    };
  }

  /* ---------------------- secp256k1 → Keccak → EIP-55 ---------------------- */
  function publicKey(k) {
    const Q = S.mulG(k);
    return { Q, raw: S.rawXY(Q), compressed: S.compressed(Q) };
  }
  function addressFromPublic(raw) {
    const hash = keccak256(raw);
    return { hash, lower: toHex(hash.slice(12)) };
  }
  // EIP-55: maiuscola dove la cifra corrispondente di keccak256(indirizzo in minuscolo) è ≥ 8
  function checksumAddress(lower) {
    lower = lower.replace(/^0x/i, '').toLowerCase();
    const h = toHex(keccak256(utf8(lower)));
    let out = '';
    for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    return { address: '0x' + out, nibbles: h.slice(0, 40) };
  }
  function validateAddress(addr) {
    const a = addr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { status: 'format', msg: 'formato non valido: servono 0x e 40 cifre esadecimali' };
    const body = a.slice(2);
    if (body === body.toLowerCase() || body === body.toUpperCase()) {
      return { status: 'nochecksum', msg: 'formato valido ma senza checksum (tutto minuscolo o tutto maiuscolo): nessun controllo possibile' };
    }
    const good = checksumAddress(body.toLowerCase()).address;
    return good === a
      ? { status: 'ok', msg: 'checksum EIP-55 corretta' }
      : { status: 'bad', msg: 'checksum EIP-55 errata: l’indirizzo contiene un errore di battitura', expected: good };
  }

  // Pipeline completa per un indice: chiave privata → indirizzo con checksum.
  function keyToAddress(k) {
    const pub = publicKey(k);
    const a = addressFromPublic(pub.raw);
    const cs = checksumAddress(a.lower);
    return { k, pub, hash: a.hash, lower: '0x' + a.lower, address: cs.address, nibbles: cs.nibbles };
  }

  root.Wallet = {
    HARD, loadWordlist, get words() { return WORDS; }, entropyToMnemonic, parseMnemonic, mnemonicToSeed,
    masterKey, ckdPriv, ckdPub, parsePath, derivePath, serializeMaster,
    publicKey, addressFromPublic, checksumAddress, validateAddress, keyToAddress
  };
})(window);

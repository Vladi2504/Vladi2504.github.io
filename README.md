# Vladi2504.github.io

Sito personale pubblicato con GitHub Pages: **https://vladi2504.github.io**

Contiene una home generica, l'elenco dei progetti e il materiale dei corsi universitari.

## Struttura

```
index.html                 home (progetti letti dall'API di GitHub)
assets/css/style.css       stile comune, tema chiaro/scuro
assets/js/site.js          header, footer e cambio tema
statistica/index.html      elenco degli homework di Statistica
statistica/hw1/            HW1: chiave privata → chiave pubblica (curve ellittiche)
  index.html               relazione + applicazione interattiva
  js/ecc.js                aritmetica sulla curva giocattolo (addizione, double-and-add)
  js/program.js            il programma richiesto: stampa G, 2G, …, kG
  js/visual.js             visualizzazione rallentata (canvas)
  js/realcurve.js          intuizione geometrica sui reali
  js/stats.js              esplorazione statistica
  js/charts.js             mini libreria di grafici SVG
  js/hashes.js             SHA-256 e Keccak-256
  js/secp256k1.js          bonus: la curva reale di Ethereum con BigInt
statistica/hw2/            HW2: dal seed del wallet all'indirizzo Ethereum
  js/primitives.js         SHA-256, Keccak-256, SHA3-256, Base58Check; SHA-512/HMAC/PBKDF2 via Web Crypto
  js/secp256k1.js          secp256k1 veloce (coordinate Jacobiane + tabella 2^i·G)
  js/wallet.js             BIP-39, BIP-32, BIP-44, indirizzo, EIP-55
  js/lab.js                laboratorio interattivo della pipeline
  js/demos.js              attacco xpub, verifica EIP-55, confronto delle hash
  js/stats2.js             esperimenti statistici E1–E5
assets/js/charts.js        mini libreria di grafici SVG condivisa
```

## Aggiungere un nuovo homework

1. Copia la cartella `statistica/hw1` in `statistica/hw2` e modifica `index.html`.
2. Aggiungi una card in `statistica/index.html`.

## Provare il sito in locale

```bash
python -m http.server 8000
```

Poi apri http://localhost:8000.

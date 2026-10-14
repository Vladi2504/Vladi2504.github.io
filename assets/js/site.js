/* ==========================================================================
   site.js — header, footer e tema chiaro/scuro comuni a tutte le pagine.
   Ogni pagina indica il percorso della radice del sito con <body data-root="...">
   (es. "./" per la home, "../../" per statistica/hw1/), così i link funzionano
   sia su GitHub Pages sia aprendo i file in locale.
   ========================================================================== */
(function () {
  'use strict';

  const SITE = {
    author: 'Vladut Florian Stanciu',
    github: 'https://github.com/Vladi2504',
    repo: 'https://github.com/Vladi2504/Vladi2504.github.io',
    nav: [
      { href: '', label: 'Home', id: 'home' },
      { href: 'statistica/', label: 'Statistica', id: 'statistica' },
      { href: '#progetti', label: 'Progetti', id: 'progetti', homeOnly: true, cls: 'hide-sm' }
    ]
  };
  window.SITE = SITE;

  const root = document.body.dataset.root || './';
  const current = document.body.dataset.page || '';

  // --- tema ----------------------------------------------------------------
  function storedTheme() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }
  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) { /* storage non disponibile */ }
    document.dispatchEvent(new CustomEvent('themechange'));
  }
  const st = storedTheme();
  if (st === 'light' || st === 'dark') document.documentElement.setAttribute('data-theme', st);
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      document.dispatchEvent(new CustomEvent('themechange'));
    });
  }

  const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  // --- header --------------------------------------------------------------
  const header = document.querySelector('[data-site-header]');
  if (header) {
    const links = SITE.nav
      .filter(function (n) { return !n.homeOnly || current === 'home'; })
      .map(function (n) {
        const href = n.href.startsWith('#') ? n.href : root + n.href;
        const cur = n.id === current ? ' aria-current="page"' : '';
        return '<a href="' + href + '"' + cur + (n.cls ? ' class="' + n.cls + '"' : '') + '>' + n.label + '</a>';
      }).join('');
    header.className = 'site-header';
    header.innerHTML =
      '<div class="inner">' +
        '<a class="brand" href="' + root + '"><span class="logo">VS</span><span class="name">' + SITE.author + '</span></a>' +
        '<nav class="nav" aria-label="Navigazione principale">' + links +
          '<a href="' + SITE.github + '" target="_blank" rel="noopener" class="hide-sm">GitHub</a>' +
        '</nav>' +
        '<button class="theme-toggle" type="button" aria-label="Cambia tema chiaro/scuro"></button>' +
      '</div>';
    const btn = header.querySelector('.theme-toggle');
    const paint = function () { btn.innerHTML = isDark() ? sun : moon; };
    paint();
    btn.addEventListener('click', function () { setTheme(isDark() ? 'light' : 'dark'); paint(); });
    document.addEventListener('themechange', paint);
  }

  // --- footer --------------------------------------------------------------
  const footer = document.querySelector('[data-site-footer]');
  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML =
      '<div class="inner">' +
        '<span>© ' + new Date().getFullYear() + ' ' + SITE.author + '</span>' +
        '<span><a href="' + SITE.repo + '" target="_blank" rel="noopener">Codice sorgente del sito</a> · ' +
        'ospitato su GitHub Pages</span>' +
      '</div>';
  }
})();

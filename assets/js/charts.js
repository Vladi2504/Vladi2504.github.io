/* ==========================================================================
   charts.js — mini libreria SVG per istogrammi e grafici a dispersione.
   I colori sono variabili CSS (style="fill:var(--series-1)"), quindi i grafici
   seguono automaticamente il tema chiaro/scuro. Si ridisegnano al resize.
   ========================================================================== */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  let tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tooltip';
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(html, ev) {
    const t = tooltip();
    t.innerHTML = html;
    t.classList.add('show');
    const pad = 14;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { if (tip) tip.classList.remove('show'); }

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, opts = {}) {
    const t = el('text', {
      x, y,
      'text-anchor': opts.anchor || 'middle',
      'dominant-baseline': opts.baseline || 'auto',
      style: `fill:${opts.color || 'var(--muted)'};font-size:${opts.size || 11}px;font-family:var(--font);` +
        (opts.tabular ? 'font-variant-numeric:tabular-nums;' : '') + (opts.weight ? `font-weight:${opts.weight};` : '')
    }, parent);
    t.textContent = str;
    return t;
  }

  function niceTicks(max, count = 4) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { max: top, ticks };
  }
  const fmtNum = v => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('it-IT')
    : Number.isInteger(v) ? String(v) : v.toLocaleString('it-IT', { maximumFractionDigits: 2 }));

  // Barra con estremo dati arrotondato (4px) e base squadrata.
  function barPath(x, y0, w, h) {
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    const y = y0 - h;
    return `M${x},${y0} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y0} Z`;
  }

  function mount(container, draw) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    host.classList.add('chart');
    let lastW = 0;
    const render = () => {
      const w = Math.round(host.clientWidth);
      if (!w || w === lastW) return;
      lastW = w;
      host.innerHTML = '';
      draw(host, w);
    };
    render();
    if (root.ResizeObserver) {
      const ro = new ResizeObserver(render);
      ro.observe(host);
    }
    return host;
  }

  /* --------------------------------------------------------------------------
     bars(container, {
       categories: [...],                       etichette dell'asse x
       series: [{ name, color, values: [...] }],
       expected: [...] | null,                  valore atteso per categoria (tacca)
       ref: { value, label } | null,            linea orizzontale di riferimento
       yMax, yLabel, xLabel, height, tooltip(i) → html, labelEvery
     })
     -------------------------------------------------------------------------- */
  function bars(container, o) {
    return mount(container, (host, W) => {
      const H = o.height || 220;
      const m = { t: 10, r: 8, b: o.xLabel ? 42 : 26, l: 44 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const n = o.categories.length;
      const S = o.series.length;
      let dataMax = 0;
      o.series.forEach(s => s.values.forEach(v => { if (v > dataMax) dataMax = v; }));
      if (o.expected) o.expected.forEach(v => { if (v > dataMax) dataMax = v; });
      if (o.ref) dataMax = Math.max(dataMax, o.ref.value);
      const { max, ticks } = o.yMax != null ? { max: o.yMax, ticks: niceTicks(o.yMax).ticks.filter(t => t <= o.yMax + 1e-9) } : niceTicks(dataMax * 1.05);
      const y = v => m.t + ih - (v / max) * ih;

      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.ariaLabel || 'grafico a barre' }, host);
      // griglia e tacche y
      ticks.forEach(t => {
        el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), style: `stroke:${t === 0 ? 'var(--axis)' : 'var(--grid)'};stroke-width:1` }, svg);
        text(svg, m.l - 6, y(t) + 4, o.yFormat ? o.yFormat(t) : fmtNum(t), { anchor: 'end', tabular: true });
      });
      if (o.yLabel) {
        const t = text(svg, 12, m.t + ih / 2, o.yLabel, { size: 11 });
        t.setAttribute('transform', `rotate(-90 12 ${m.t + ih / 2})`);
      }

      const band = iw / n;
      const gap = 2;
      const groupW = Math.min(band - Math.max(gap, band * 0.18), 24 * S + gap * (S - 1));
      const bw = Math.max(1, (groupW - gap * (S - 1)) / S);
      const every = o.labelEvery || Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / 44))));

      for (let i = 0; i < n; i++) {
        const cx = m.l + band * i + band / 2;
        const gx = cx - groupW / 2;
        o.series.forEach((s, j) => {
          const v = s.values[i];
          const d = barPath(gx + j * (bw + gap), y(0), bw, y(0) - y(Math.min(v, max)));
          if (d) el('path', { d, style: `fill:${s.color}` }, svg);
        });
        if (o.expected && o.expected[i] != null) {
          const ey = y(o.expected[i]);
          el('line', { x1: gx - 2, x2: gx + groupW + 2, y1: ey, y2: ey, style: 'stroke:var(--text);stroke-width:1.5;opacity:.75' }, svg);
        }
        if (i % every === 0 || n <= 12) text(svg, cx, H - m.b + 15, String(o.categories[i]), { tabular: true });
      }
      if (o.ref) {
        el('line', { x1: m.l, x2: W - m.r, y1: y(o.ref.value), y2: y(o.ref.value), style: 'stroke:var(--text);stroke-width:1.5;opacity:.6' }, svg);
        if (o.ref.label) text(svg, W - m.r - 2, y(o.ref.value) - 5, o.ref.label, { anchor: 'end', color: 'var(--text-2)' });
      }
      if (o.xLabel) text(svg, m.l + iw / 2, H - 6, o.xLabel, { size: 11 });

      // livello di hover: una banda trasparente per categoria
      const hl = el('rect', { x: 0, y: m.t, width: band, height: ih, style: 'fill:var(--text);opacity:0;pointer-events:none' }, svg);
      for (let i = 0; i < n; i++) {
        const r = el('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' }, svg);
        const html = () => (o.tooltip ? o.tooltip(i) :
          `<b>${o.categories[i]}</b><br>` + o.series.map(s => `${s.name}: ${fmtNum(s.values[i])}`).join('<br>'));
        r.addEventListener('pointermove', ev => {
          hl.setAttribute('x', m.l + band * i); hl.style.opacity = 0.05;
          showTip(html(), ev);
        });
        r.addEventListener('pointerleave', () => { hl.style.opacity = 0; hideTip(); });
      }
    });
  }

  /* --------------------------------------------------------------------------
     scatter(container, { points: [{x, y, label}], xMax, yMax, xLabel, yLabel,
                          color, height, tooltip(pt) → html, diagonal })
     -------------------------------------------------------------------------- */
  function scatter(container, o) {
    return mount(container, (host, W) => {
      const H = o.height || Math.min(320, Math.max(220, W * 0.55));
      const m = { t: 10, r: 10, b: 42, l: 48 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      // dominio esatto [0, max]: le tacche sono valori "tondi" al suo interno
      const fit = v => ({ max: v, ticks: niceTicks(v).ticks.filter(t => t <= v) });
      const xs = fit(o.xMax), ys = fit(o.yMax);
      const X = v => m.l + (v / xs.max) * iw;
      const Y = v => m.t + ih - (v / ys.max) * ih;
      const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.ariaLabel || 'grafico a dispersione' }, host);
      ys.ticks.forEach(t => {
        el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), style: `stroke:${t === 0 ? 'var(--axis)' : 'var(--grid)'};stroke-width:1` }, svg);
        text(svg, m.l - 6, Y(t) + 4, fmtNum(t), { anchor: 'end', tabular: true });
      });
      xs.ticks.forEach(t => text(svg, X(t), H - m.b + 15, fmtNum(t), { tabular: true }));
      if (o.xLabel) text(svg, m.l + iw / 2, H - 6, o.xLabel);
      if (o.yLabel) {
        const t = text(svg, 12, m.t + ih / 2, o.yLabel);
        t.setAttribute('transform', `rotate(-90 12 ${m.t + ih / 2})`);
      }
      const many = o.points.length > 400;
      const r = many ? 2 : 4;
      const g = el('g', { style: `fill:${o.color || 'var(--series-1)'};opacity:${many ? 0.55 : 0.9}` }, svg);
      const scr = o.points.map(p => [X(p.x), Y(p.y)]);
      scr.forEach(([cx, cy]) => el('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r }, g));

      const ring = el('circle', { r: r + 3, style: 'fill:none;stroke:var(--text);stroke-width:2;opacity:0' }, svg);
      const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
      hit.addEventListener('pointermove', ev => {
        const box = svg.getBoundingClientRect();
        const px = ev.clientX - box.left, py = ev.clientY - box.top;
        let best = -1, bd = 400;
        for (let i = 0; i < scr.length; i++) {
          const dx = scr[i][0] - px, dy = scr[i][1] - py, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) { ring.style.opacity = 0; hideTip(); return; }
        ring.setAttribute('cx', scr[best][0]); ring.setAttribute('cy', scr[best][1]); ring.style.opacity = 0.8;
        const pt = o.points[best];
        showTip(o.tooltip ? o.tooltip(pt) : `x = ${pt.x}, y = ${pt.y}`, ev);
      });
      hit.addEventListener('pointerleave', () => { ring.style.opacity = 0; hideTip(); });
    });
  }

  root.Charts = { bars, scatter, fmtNum };
})(window);

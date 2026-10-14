/* ==========================================================================
   realcurve.js — intuizione geometrica: la stessa curva y² = x³ + 7 sui reali.
   Due cursori muovono P e Q lungo la curva; si vedono la retta (o la tangente),
   il terzo punto di intersezione −R e il simmetrico R = P + Q.
   ========================================================================== */
(function () {
  'use strict';
  const cv = document.getElementById('real-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const sP = document.getElementById('real-p');
  const sQ = document.getElementById('real-q');
  const cbD = document.getElementById('real-double');
  const out = document.getElementById('real-out');

  const B = 7;
  const X0 = -Math.cbrt(B);         // dove la curva taglia l'asse x
  const XMAX = 4.2;
  const view = { x0: -3, x1: 6.5, y0: -10, y1: 10 };

  // t ∈ [−1, 1] percorre tutta la curva: t > 0 ramo superiore, t < 0 inferiore
  function pointAt(t) {
    const x = X0 + Math.abs(t) * (XMAX - X0);
    const y = Math.sign(t || 1) * Math.sqrt(Math.max(0, x * x * x + B));
    return { x, y };
  }

  let W = 0, H = 0, dpr = 1, colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    colors = { text: g('--text'), text2: g('--text-2'), muted: g('--muted'), grid: g('--grid'), axis: g('--axis'),
      s1: g('--series-1'), s2: g('--series-2'), s3: g('--series-3'), surface: g('--surface') };
  }
  const X = x => ((x - view.x0) / (view.x1 - view.x0)) * W;
  const Y = y => H - ((y - view.y0) / (view.y1 - view.y0)) * H;

  function dot(P, r, fill, ring) {
    ctx.beginPath(); ctx.arc(X(P.x), Y(P.y), r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke(); }
  }
  function label(s, P, dx, dy) {
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = colors.text;
    ctx.fillText(s, X(P.x) + dx, Y(P.y) + dy);
  }

  function draw() {
    dpr = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // assi
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    for (let gx = Math.ceil(view.x0); gx <= view.x1; gx++) { ctx.beginPath(); ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), H); ctx.stroke(); }
    for (let gy = -10; gy <= 10; gy += 2) { ctx.beginPath(); ctx.moveTo(0, Y(gy)); ctx.lineTo(W, Y(gy)); ctx.stroke(); }
    ctx.strokeStyle = colors.axis;
    ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), H); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();

    // curva
    ctx.strokeStyle = colors.muted; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = -400; i <= 400; i++) {
      const P = pointAt(i / 400);
      if (i === -400) ctx.moveTo(X(P.x), Y(P.y)); else ctx.lineTo(X(P.x), Y(P.y));
    }
    ctx.stroke();

    const dbl = cbD.checked;
    const P = pointAt(parseFloat(sP.value));
    const Q = dbl ? P : pointAt(parseFloat(sQ.value));
    sQ.disabled = dbl;

    let lambda, vertical = false;
    const same = Math.abs(P.x - Q.x) < 1e-9 && Math.abs(P.y - Q.y) < 1e-9;
    if (dbl || same) {
      if (Math.abs(P.y) < 1e-9) vertical = true; else lambda = (3 * P.x * P.x) / (2 * P.y);
    } else if (Math.abs(P.x - Q.x) < 1e-9) {
      vertical = true; // Q = −P
    } else {
      lambda = (Q.y - P.y) / (Q.x - P.x);
    }

    if (vertical) {
      ctx.strokeStyle = colors.s2; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(P.x), 0); ctx.lineTo(X(P.x), H); ctx.stroke();
      dot(P, 6, colors.s1, colors.surface);
      label(dbl ? 'P = Q' : 'P', P, 10, -8);
      if (!dbl) { dot(Q, 6, colors.s3, colors.surface); label('Q', Q, 10, 16); }
      out.textContent = 'Retta verticale: non c\'è un terzo punto "al finito", quindi P + Q = O (punto all\'infinito).';
      return;
    }

    const x3 = lambda * lambda - P.x - Q.x;
    const y3 = lambda * (P.x - x3) - P.y;
    const third = { x: x3, y: -y3 }, R = { x: x3, y: y3 };

    // retta / tangente
    ctx.strokeStyle = colors.s2; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(view.x0), Y(P.y + lambda * (view.x0 - P.x)));
    ctx.lineTo(X(view.x1), Y(P.y + lambda * (view.x1 - P.x)));
    ctx.stroke();
    // riflessione
    ctx.setLineDash([5, 4]); ctx.strokeStyle = colors.text2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(third.x), Y(third.y)); ctx.lineTo(X(R.x), Y(R.y)); ctx.stroke();
    ctx.setLineDash([]);

    dot(third, 6, colors.s2, colors.surface); label('−R', third, 10, third.y > 0 ? -8 : 16);
    dot(R, 7, colors.text, colors.surface); label('R = P + Q', R, 10, R.y > 0 ? -8 : 16);
    dot(P, 6, colors.s1, colors.surface); label(dbl ? 'P = Q' : 'P', P, -12, -12);
    if (!dbl) { dot(Q, 6, colors.s3, colors.surface); label('Q', Q, -12, -12); }

    const f = v => v.toFixed(2).replace('.', ',').replace('-', '−');
    const visible = x3 >= view.x0 && x3 <= view.x1 && Math.abs(y3) <= view.y1;
    out.textContent = `λ = ${f(lambda)}   P = (${f(P.x)}, ${f(P.y)})   ` + (dbl ? '' : `Q = (${f(Q.x)}, ${f(Q.y)})   `) +
      `R = P + Q = (${f(x3)}, ${f(y3)})` + (visible ? '' : '   (fuori dall\'area visibile)');
  }

  [sP, sQ, cbD].forEach(e => e.addEventListener('input', draw));
  document.addEventListener('themechange', () => { readColors(); draw(); });
  if (window.ResizeObserver) new ResizeObserver(draw).observe(cv);
  readColors();
  draw();
})();

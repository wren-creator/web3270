// ── GDDM Graphics Renderer ───────────────────────────────────────────
// Draws the primitives decoded by tn3270/gddm.js (server-side) onto a
// <canvas> overlay on top of the character grid. Demo-scale renderer:
// lines, markers, text, and arcs/circles/ellipses — see tn3270/gddm.js
// for the full scope boundary (no fillets/images/symbol sets/clipping).
// Set Color order names (tn3270/gddm.js COLOR_NAME) → how to paint them.
// Reuses the terminal's own CSS custom properties so a chart always
// matches the active theme (including the Barbie easter egg); 'pink'
// and 'background' have no --t-* var (see terminal.css .c-pink), so
// those two are hardcoded to match the equivalent alphanumeric color.
const COLOR_VAR = {
  default: '--t-green', blue: '--t-blue', red: '--t-red',
  green: '--t-green', turquoise: '--t-turquoise', yellow: '--t-yellow',
  white: '--t-white',
};
const COLOR_FALLBACK = { pink: '#ff88cc', background: '#000810' };

function _resolveColor(name) {
  const varName = COLOR_VAR[name];
  if (varName) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (v) return v;
  }
  return COLOR_FALLBACK[name] || '#33ff66';
}

function _ensureCanvas() {
  const term = document.getElementById('terminal');
  if (!term) return null;
  let canvas = term.querySelector('.gddm-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'gddm-canvas';
    term.appendChild(canvas);
  }
  const rect = term.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  return canvas;
}

// Arc Parameters (P,Q,R,S) describe a linear map from the unit circle
// to the target ellipse: world = A · unit, where A = [[P,R],[S,Q]] (i.e.
// worldX = P·x + R·y, worldY = S·x + Q·y).
function _arcMatrix({ P, Q, R, S }) { return { a: P, b: S, c: R, d: Q }; }
// Inverts A so a three-point arc's world-space points can be mapped
// back to a true circle for circumcircle math. Returns null for a
// degenerate (non-invertible) shape.
function _invertArcMatrix({ P, Q, R, S }) {
  const det = P * Q - R * S;
  if (!det) return null;
  return { a: Q / det, b: -S / det, c: -R / det, d: P / det };
}
function _applyMatrix({ a, b, c, d }, x, y) { return [a * x + c * y, b * x + d * y]; }

// Circumcircle of 3 points — used to recover the true circle that a
// three-point Arc order's start/mid/end points lie on once they've
// been mapped back through the inverse arc-parameter matrix. Returns
// null if the points are collinear (degenerate arc).
function _circumcircle([ax, ay], [bx, by], [cx, cy]) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!d) return null;
  const ax2ay2 = ax * ax + ay * ay, bx2by2 = bx * bx + by * by, cx2cy2 = cx * cx + cy * cy;
  const ux = (ax2ay2 * (by - cy) + bx2by2 * (cy - ay) + cx2cy2 * (ay - by)) / d;
  const uy = (ax2ay2 * (cx - bx) + bx2by2 * (ax - cx) + cx2cy2 * (bx - ax)) / d;
  return { x: ux, y: uy, r: Math.hypot(ax - ux, ay - uy) };
}

// Does sweeping counterclockwise (increasing angle) from `from` reach
// `mid` at or before reaching `to`? Used to pick which of the two ways
// around the circumcircle is the one the three arc points actually lie on.
function _ccwReachesFirst(from, mid, to) {
  const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const dMid = norm(mid - from), dTo = norm(to - from);
  return dMid <= dTo;
}

export function gddmClear() {
  const term = document.getElementById('terminal');
  const canvas = term && term.querySelector('.gddm-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

export function gddmOnScreen(msg) {
  const canvas = _ensureCanvas();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { boundary, primitives } = msg;
  if (!boundary || !primitives || !primitives.length) return;

  const { xL, xU, yL, yU } = boundary;
  const spanX = (xU - xL) || 1, spanY = (yU - yL) || 1;
  const sx = canvas.width / spanX, sy = canvas.height / spanY;
  // GDF picture space is bottom-left origin; canvas is top-left — flip Y.
  const toPx = (x, y) => [
    ((x - xL) / spanX) * canvas.width,
    canvas.height - ((y - yL) / spanY) * canvas.height,
  ];

  for (const p of primitives) {
    ctx.strokeStyle = ctx.fillStyle = _resolveColor(p.color);
    if (p.type === 'line' && p.points.length >= 2) {
      ctx.beginPath();
      const [x0, y0] = toPx(...p.points[0]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < p.points.length; i++) {
        const [x, y] = toPx(...p.points[i]);
        ctx.lineTo(x, y);
      }
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (p.type === 'marker') {
      for (const pt of p.points) {
        const [x, y] = toPx(...pt);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.type === 'text') {
      const [x, y] = toPx(p.x, p.y);
      ctx.font = "12px 'IBM Plex Mono', monospace";
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.text, x, y);
    } else if (p.type === 'fullArc') {
      // World point(θ) = center + M·A·(cos θ, sin θ) — draw as a unit
      // circle under a canvas transform baking in M·A and the pixel scale/flip.
      const { P, Q, R, S } = p.arcParams;
      const [ex, ey] = toPx(p.cx, p.cy);
      ctx.save();
      ctx.transform(sx * p.scale * P, -sy * p.scale * S, sx * p.scale * R, -sy * p.scale * Q, ex, ey);
      ctx.lineWidth = 1.5 / Math.max(1e-6, Math.hypot(sx * p.scale, sy * p.scale));
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    } else if (p.type === 'arc3') {
      // Three-point arc: map the given points back through the inverse
      // arc-parameter matrix to recover the true circle they lie on
      // (circumcircle), then draw forward via the same transform trick
      // as fullArc, with the circumcircle's radius baked into the matrix
      // scale so the local draw is a unit-circle arc.
      const Ainv = _invertArcMatrix(p.arcParams);
      if (!Ainv) continue;
      const v0 = _applyMatrix(Ainv, ...p.p0), v1 = _applyMatrix(Ainv, ...p.p1), v2 = _applyMatrix(Ainv, ...p.p2);
      const circle = _circumcircle(v0, v1, v2);
      if (!circle) continue;
      const { x: cvx, y: cvy, r: rv } = circle;
      const angle0 = Math.atan2(v0[1] - cvy, v0[0] - cvx);
      const angle1 = Math.atan2(v1[1] - cvy, v1[0] - cvx);
      const angle2 = Math.atan2(v2[1] - cvy, v2[0] - cvx);
      const anticlockwise = !_ccwReachesFirst(angle0, angle1, angle2);
      const { P, Q, R, S } = p.arcParams;
      const [worldCx, worldCy] = _applyMatrix(_arcMatrix(p.arcParams), cvx, cvy);
      const [ex, ey] = toPx(worldCx, worldCy);
      ctx.save();
      ctx.transform(rv * sx * P, rv * -sy * S, rv * sx * R, rv * -sy * Q, ex, ey);
      ctx.lineWidth = 1.5 / Math.max(1e-6, rv * Math.hypot(sx, sy));
      ctx.beginPath();
      ctx.arc(0, 0, 1, angle0, angle2, anticlockwise);
      ctx.stroke();
      ctx.restore();
    }
  }
}

Object.assign(window, { gddmOnScreen, gddmClear });

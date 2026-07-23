// ── GDDM Graphics Renderer ───────────────────────────────────────────
// Draws the primitives decoded by tn3270/gddm.js (server-side) onto a
// <canvas> overlay on top of the character grid. Demo-scale renderer:
// lines, markers, text, arcs/circles/ellipses, fillets, non-default
// character sets, and monochrome images — see tn3270/gddm.js for the
// full scope boundary (no color-mix/clipping).
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

// Vector symbol sets — GDDM's Character Set order (X'38') only ever
// selects a symbol set by LCID; per the 3270 Data Stream Programmer's
// Reference, the Object Data structured field's OBJTYP has no value
// for transmitting symbol-set glyph data (only Graphics X'00' and
// Image X'01' exist), so a symbol set is necessarily a resource the
// terminal already has, same as a built-in font. This table is that
// resource for LCID 0x41 (first of the "user-defined" range X'41'-
// X'DF', per Appendix D "Character set") — a small 7-segment-style
// digit set. Each glyph is a list of independent strokes (arrays of
// [x,y] points in a 0-100 local box, bottom-left origin, matching GDF
// convention) drawn with moveTo/lineTo, modeled on the real Vector
// Symbol Set's "line vs move" primitive semantics (GDDM Base
// Programming Reference, Appendix F) without needing that format's
// byte-level encoding, since this data is never actually serialized
// over the wire in the real protocol.
const SEGMENT = {
  a: [[10, 90], [90, 90]], b: [[90, 90], [90, 50]], c: [[90, 50], [90, 10]],
  d: [[10, 10], [90, 10]], e: [[10, 50], [10, 10]], f: [[10, 90], [10, 50]],
  g: [[10, 50], [90, 50]],
};
const DIGIT_SEGMENTS = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};
const DIGIT_GLYPHS = Object.fromEntries(
  Object.entries(DIGIT_SEGMENTS).map(([digit, segs]) => [digit, [...segs].map(s => SEGMENT[s])])
);
const VECTOR_SYMBOL_SETS = {
  0x41: { cellWpx: 11, cellHpx: 18, advancePx: 13, glyphs: DIGIT_GLYPHS },
};

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
    } else if (p.type === 'fillet' && p.points.length >= 2) {
      // Polyfillet: a curve tangent to the first/last line at their
      // endpoints and to intermediate lines at their midpoints. This is
      // exactly the classic "quadratic curve through consecutive
      // midpoints" construction — each piece's control point is an
      // original vertex, so tangent directions match the adjacent line
      // segments by construction. Affine-invariant (midpoints and
      // quadratic Beziers survive toPx's scale+flip), so it's safe to
      // do the curve fit directly in pixel space.
      const pts = p.points.map(pt => toPx(...pt));
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 2; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const cp = pts[pts.length - 2], end = pts[pts.length - 1];
      ctx.quadraticCurveTo(cp[0], cp[1], end[0], end[1]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (p.type === 'vtext') {
      // Non-default character set: render each character from the
      // client's own vector symbol set table rather than the browser
      // font, positioned at a fixed pixel size (like the default
      // 'text' path) so it sits comfortably next to regular labels.
      const set = VECTOR_SYMBOL_SETS[p.charSet];
      if (!set) continue;
      const [anchorX, anchorY] = toPx(p.x, p.y);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < p.text.length; i++) {
        const glyph = set.glyphs[p.text[i]];
        if (!glyph) continue;
        const gx = anchorX + i * set.advancePx;
        for (const stroke of glyph) {
          ctx.beginPath();
          stroke.forEach(([lx, ly], j) => {
            const px = gx + (lx / 100) * set.cellWpx;
            const py = anchorY - (ly / 100) * set.cellHpx;
            if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.stroke();
        }
      }
    } else if (p.type === 'image' && p.width > 0 && p.depth > 0) {
      // Monochrome bitmap: 1 bit per display point, MSB first, one
      // Image Data row per order. The manual doesn't state which row
      // comes first or which corner (x0,y0) anchors — this renderer's
      // reasoned interpretation (matching ordinary raster convention)
      // is that rows arrive top-to-bottom and (x0,y0) is the
      // bottom-left corner, so row 0 sits at the top of the image.
      const off = document.createElement('canvas');
      off.width = p.width; off.height = p.depth;
      const offCtx = off.getContext('2d');
      offCtx.fillStyle = _resolveColor(p.color);
      for (let r = 0; r < p.rows.length; r++) {
        const row = p.rows[r];
        for (let c = 0; c < p.width; c++) {
          const byte = row[c >> 3];
          if (byte === undefined) continue;
          if ((byte >> (7 - (c & 7))) & 1) offCtx.fillRect(c, r, 1, 1);
        }
      }
      const [x0px, y0px] = toPx(p.x0, p.y0 + p.imageDepth); // top-left
      const [x1px, y1px] = toPx(p.x0 + p.imageWidth, p.y0); // bottom-right
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, x0px, y0px, x1px - x0px, y1px - y0px);
      ctx.imageSmoothingEnabled = true;
    }
  }
}

Object.assign(window, { gddmOnScreen, gddmClear });

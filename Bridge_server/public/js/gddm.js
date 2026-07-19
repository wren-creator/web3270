// ── GDDM Graphics Renderer ───────────────────────────────────────────
// Draws the primitives decoded by tn3270/gddm.js (server-side) onto a
// <canvas> overlay on top of the character grid. Demo-scale renderer:
// lines, markers, and text only — see tn3270/gddm.js for the full scope
// boundary (no arcs/fillets/images/symbol sets/clipping).
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
    }
  }
}

Object.assign(window, { gddmOnScreen, gddmClear });

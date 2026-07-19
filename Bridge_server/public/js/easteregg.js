// Hidden "Barbie" theme — click the topbar logo to toggle. No visible affordance.
// Distinct hues per field-color var (not a flat pink wash) so the 3270 extended-color
// semantics (errors/headers/highlights) stay legible in the joke palette too.
const BARBIE_VARS = {
  '--t-bg':          '#1a0510',
  '--t-field-bg':    '#33001a',
  '--t-green':       '#ff5fa8',
  '--t-cursor':      '#fff5fa',
  '--t-blue':        '#c77dff',
  '--t-red':         '#ff2d55',
  '--t-turquoise':   '#00e0c0',
  '--t-yellow':      '#ffd700',
  '--t-white':       '#fff0c2',
  '--bg-primary':    '#1a0510',
  '--bg-secondary':  '#2b0a1f',
  '--bg-panel':      '#3a0f2a',
  '--bg-elevated':   '#4a1436',
  '--border':        '#ff8fc4',
  '--border-bright': '#ff5fa8',
  '--accent-blue':   '#c77dff',
  '--accent-cyan':   '#00e0c0',
  '--accent-green':  '#ff5fa8',
  '--accent-amber':  '#ffd700',
  '--text-primary':  '#fff5fa',
  '--text-dim':      '#ffb6d9',
  '--text-muted':    '#e0709e',
  '--logo-bg':        '#ff5fa8',
  '--logo-ring':       '#ffffff',
  '--logo-ring-light': '#ffd700',
};

const STORAGE_KEY = 'wt3270-egg-barbie';
let savedVars = null;
let active = false;

function apply(on) {
  const root = document.documentElement.style;
  if (on) {
    savedVars = {};
    for (const k of Object.keys(BARBIE_VARS)) savedVars[k] = root.getPropertyValue(k);
    for (const [k, v] of Object.entries(BARBIE_VARS)) root.setProperty(k, v);
  } else if (savedVars) {
    for (const [k, v] of Object.entries(savedVars)) {
      if (v) root.setProperty(k, v); else root.removeProperty(k);
    }
    savedVars = null;
  }
  active = on;
}

function toggle() {
  apply(!active);
  try { localStorage.setItem(STORAGE_KEY, active ? '1' : '0'); } catch {}
}

export function initBarbieEgg() {
  const logo = document.getElementById('logo');
  if (logo) logo.addEventListener('click', toggle);

  let saved = false;
  try { saved = localStorage.getItem(STORAGE_KEY) === '1'; } catch {}
  if (saved) apply(true);
}

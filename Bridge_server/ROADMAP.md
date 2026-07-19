# Roadmap

## Graphics
- [ ] Full GDDM renderer fidelity: `tn3270/gddm.js` currently decodes a demo-scale subset of the GDF order stream (Comment/picture-boundary, Set Color, Line, Marker, Character String, enough to draw a real labeled chart, see `mock-lpar.js`'s `GDDM` TSO command). Arcs, fillets, images, symbol sets, color-mix modes, and clipping are not implemented. Extending coverage would mean more order-code branches in `decodeGdfStream()` plus matching draw calls in `public/js/gddm.js`'s canvas renderer.

## Theming
- [x] Hidden "Barbie" theme easter egg — secret click on the topbar logo flips a full pink/gold palette (terminal + chrome + logo icon), persisted in localStorage. No visible affordance by design.
- [ ] Company/corporate theme support — per-deployment logo + brand colors. Should extend the existing visible theme system (`public/js/settings.js` `THEMES` object + `.theme-swatches` UI in `tn3270-client.html`) rather than build a new mechanism: add a named entry + a swatch, same as `green`/`blue`/`amber`/`white`/`teal`. Needs a swappable logo asset (the topbar SVG logo colors were decoupled to CSS vars — `--logo-bg`/`--logo-ring`/`--logo-ring-light` in `terminal.css` — as groundwork for this).

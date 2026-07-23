# Roadmap

## Graphics
- [ ] Full GDDM renderer fidelity: `tn3270/gddm.js` currently decodes a demo-scale subset of the GDF order stream (Comment/picture-boundary, Set Color, Line, Marker, Character String, enough to draw a real labeled chart, see `mock-lpar.js`'s `GDDM` TSO command). Arcs, fillets, images, symbol sets, color-mix modes, and clipping are not implemented. Extending coverage would mean more order-code branches in `decodeGdfStream()` plus matching draw calls in `public/js/gddm.js`'s canvas renderer.

## Theming
- [x] Hidden "Barbie" theme easter egg — secret click on the topbar logo flips a full pink/gold palette (terminal + chrome + logo icon), persisted in localStorage. No visible affordance by design.
- [ ] Company/corporate theme support — per-deployment logo + brand colors. Should extend the existing visible theme system (`public/js/settings.js` `THEMES` object + `.theme-swatches` UI in `tn3270-client.html`) rather than build a new mechanism: add a named entry + a swatch, same as `green`/`blue`/`amber`/`white`/`teal`. Needs a swappable logo asset (the topbar SVG logo colors were decoupled to CSS vars — `--logo-bg`/`--logo-ring`/`--logo-ring-light` in `terminal.css` — as groundwork for this).

## Session Profiles & Access Control
Feedback from the 2026-07-23 company meeting, ahead of opening the tool up beyond the original one-group user base.
- [x] Rename "LPAR PROFILES" to "session profiles" throughout the project. Matches the term users actually recognize; "LPAR" is mainframe-partition jargon that doesn't map to what the feature does for most users. Renamed UI text, JS state/identifiers, and CSS classes across `config.js`, `public/tn3270-client.html`, `public/js/walkthrough.js`, `public/js/profiles.js`, `public/js/xfer.js`, `public/js/state.js`, and `public/css/terminal.css`. Left `lpars.txt`/`lpars.shipped.txt` and `loadLparFile()`/`parseLparFile()` unchanged so existing deployments don't need a migration step.
- [ ] Private macro library — as the user base grows past the original single group, some users need macros that aren't shared/visible to the whole group.
- [ ] Role-based access control, gated on a group-admin role, covering:
  - Session profile management (view/edit) and macro edit/delete permissions.
  - **Developer/maintainer** — full access to everything.
  - **Security** — access to security tools, including entering the security-tools password.
  - **Customer** — basic views (scope still TBD), can create personal macros but cannot edit or delete other users' macros.
  - **System-admin** — no access to security tools, but the password field/prompt is still present in their view.
- [ ] VBScript-to-macro converter — a tool to convert an existing VBScript macro into the macro library's JSON format (see `state.macros` step/name/description shape in `public/js/macros.js`). Lets users bring macros over from legacy TN3270 emulators instead of rebuilding them by hand.

## Dataset Export
- [ ] Excel (.xlsx) export for dataset search/recon results, alongside the existing CSV export (`reconExportCsv()` in `public/js/recon.js`). Covers both the Dataset Recon Scanner output and general dataset search, so results can be handed off in the format most teams actually open.

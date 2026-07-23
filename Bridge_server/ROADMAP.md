# Roadmap

## Graphics
- [x] Arcs — `tn3270/gddm.js` now decodes Set Arc Parameters (X'22'), three-point Arc (X'C6'), and Full Arc (X'C7') per the GDDM Base Programming Reference (Appendix D), and `public/js/gddm.js` renders circles/ellipses via a canvas transform + circumcircle geometry for the three-point form. `mock-lpar.js`'s `GDDM` demo now exercises both. The "at current position" short forms (X'86'/X'87') are intentionally skipped, same as the existing GCHST-at-current-position handling — this decoder doesn't track current position across orders.
- [x] Fillets — `tn3270/gddm.js` now decodes the Fillet order (X'C5', a polyfillet of 2+ points). `public/js/gddm.js` renders it as a series of quadratic Bezier pieces through consecutive segment midpoints, which exactly satisfies the manual's tangency rule (curve tangent to the first/last line at their endpoints, tangent to intermediate lines at their midpoints) and its two special cases (2 points → straight line, 3 points → a single smooth arc). `mock-lpar.js`'s `GDDM` demo now draws a 5-point decorative ribbon to exercise the multi-piece case.
- [x] Character sets — `tn3270/gddm.js` now decodes the Character Set order (X'38'). Per the 3270 Data Stream Programmer's Reference (GA23-0059), the Object Data structured field's OBJTYP has no value for transmitting symbol-set glyph data at all (only Graphics X'00' and Image X'01' exist), so a symbol set is necessarily a client-resident resource, like a built-in font, not something sent over the wire — the decoder just passes the selected LCID through with the character string. `public/js/gddm.js` owns the actual glyph table (`VECTOR_SYMBOL_SETS`), currently one hand-authored 7-segment-style digit set (LCID X'41'), rendered as independent line strokes at a fixed pixel size next to regular labels. `mock-lpar.js`'s `GDDM` demo now shows a "TOTAL" readout whose digits render through this custom font, visibly distinct from the default browser-font text everywhere else on the same screen.
- [ ] Full GDDM renderer fidelity: `tn3270/gddm.js` still doesn't decode images, color-mix modes, or clipping. Extending coverage would mean more order-code branches in `decodeGdfStream()` plus matching draw calls in `public/js/gddm.js`'s canvas renderer.

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

## Background Sessions
- [ ] Detached/background sessions — let a TN3270/TN5250 session keep running server-side after the browser tab that started it closes, instead of tearing down when the WebSocket drops (today a session's lifetime is tied 1:1 to its browser WebSocket — see the `sessions` Map in `server.js` and `Tn3270Session` in `tn3270/session.js`). Useful for long-running unattended work (batch monitoring, recon scans) that shouldn't die just because someone closed a laptop lid.
- [ ] Status dashboard popup listing all running sessions (host, profile, connected duration, state) with a kill action per session, so an orphaned/background session can be terminated without restarting the whole bridge.

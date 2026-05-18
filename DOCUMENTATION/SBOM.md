# Software Bill of Materials (SBOM)

**Project:** WebTerm/3270  
**Component:** `webterm-3270-bridge`  
**Version:** 1.0.0  
**Generated:** 2026-05-18  
**License:** MIT  
**SBOM Format:** Narrative Markdown (CycloneDX/SPDX concepts)

---

## Project Overview

WebTerm/3270 is a browser-based IBM mainframe terminal emulator providing plugin-free, Java-free access to IBM z/OS (TSO/ISPF) and z/VM (CP/CMS) LPARs via a WebSocket-to-TN3270(E) bridge server.

**Repository:** `wren-creator/webterm-3270` (GitHub)  
**Runtime Environment:** Node.js ≥ 18.0.0  
**Platform:** Linux (WSL2 / Docker / Ubuntu 24)

---

## Components

### 1. First-Party Components

| Component | Type | Description | License |
|-----------|------|-------------|---------|
| `webterm-3270-bridge` | Bridge Server | WebSocket ↔ TN3270(E) protocol bridge (`server.js`, `session.js`) | MIT |
| `tn3270-client.html` | Browser Client | In-browser TN3270 terminal emulator and UI | MIT |
| `config.js` | Configuration | LPAR profile loader (`lpars.txt` parser) | MIT |
| `mock-lpar/mock-zvm.js` | Test Fixture | Mock z/VM TN3270 daemon with CP/CMS session state machine (port 3271) | MIT |
| `mock-lpar/mock-lpar.js` | Test Fixture | Mock z/OS TN3270 daemon (port 3270) | MIT |

**Published Library:**

| Package | npm Name | Version | Description | License |
|---------|----------|---------|-------------|---------|
| `node-tn3270e` | `tn3270e_library` | (see npm) | Standalone TN3270E protocol library; RFC 2355 implementation | MIT |

---

### 2. Production Dependencies

These packages are required at runtime in the bridge server.

| Package | Version (locked) | License | Source | Description |
|---------|-----------------|---------|--------|-------------|
| `ws` | 8.20.0 | MIT | https://registry.npmjs.org/ws | WebSocket server/client library; core transport between browser and bridge |

---

### 3. Development Dependencies

These packages are used during development only and are not present in production deployments.

| Package | Version (locked) | License | Source | Description |
|---------|-----------------|---------|--------|-------------|
| `nodemon` | 3.1.14 | MIT | https://registry.npmjs.org/nodemon | Auto-restart server on file changes during development |

#### Transitive Dev Dependencies (via `nodemon`)

| Package | Version (locked) | License | Source |
|---------|-----------------|---------|--------|
| `anymatch` | 3.1.3 | ISC | https://registry.npmjs.org/anymatch |
| `balanced-match` | 4.0.4 | MIT | https://registry.npmjs.org/balanced-match |
| `binary-extensions` | 2.3.0 | MIT | https://registry.npmjs.org/binary-extensions |
| `brace-expansion` | 5.0.5 | MIT | https://registry.npmjs.org/brace-expansion |
| `braces` | 3.0.3 | MIT | https://registry.npmjs.org/braces |
| `chokidar` | 3.6.0 | MIT | https://registry.npmjs.org/chokidar |
| `debug` | 4.4.3 | MIT | https://registry.npmjs.org/debug |
| `fill-range` | 7.1.1 | MIT | https://registry.npmjs.org/fill-range |
| `glob-parent` | 5.1.2 | ISC | https://registry.npmjs.org/glob-parent |
| `has-flag` | 3.0.0 | MIT | https://registry.npmjs.org/has-flag |
| `ignore-by-default` | 1.0.1 | ISC | https://registry.npmjs.org/ignore-by-default |
| `is-binary-path` | 2.1.0 | MIT | https://registry.npmjs.org/is-binary-path |
| `is-extglob` | 2.1.1 | MIT | https://registry.npmjs.org/is-extglob |
| `is-glob` | 4.0.3 | MIT | https://registry.npmjs.org/is-glob |
| `is-number` | 7.0.0 | MIT | https://registry.npmjs.org/is-number |
| `minimatch` | 10.2.5 | BlueOak-1.0.0 | https://registry.npmjs.org/minimatch |
| `ms` | 2.1.3 | MIT | https://registry.npmjs.org/ms |
| `normalize-path` | 3.0.0 | MIT | https://registry.npmjs.org/normalize-path |
| `picomatch` | 2.3.2 | MIT | https://registry.npmjs.org/picomatch |
| `pstree.remy` | 1.1.8 | MIT | https://registry.npmjs.org/pstree.remy |
| `readdirp` | 3.6.0 | MIT | https://registry.npmjs.org/readdirp |
| `semver` | 7.7.4 | ISC | https://registry.npmjs.org/semver |
| `simple-update-notifier` | 2.0.0 | MIT | https://registry.npmjs.org/simple-update-notifier |
| `supports-color` | 5.5.0 | MIT | https://registry.npmjs.org/supports-color |
| `to-regex-range` | 5.0.1 | MIT | https://registry.npmjs.org/to-regex-range |
| `touch` | 3.1.1 | ISC | https://registry.npmjs.org/touch |
| `undefsafe` | 2.0.5 | MIT | https://registry.npmjs.org/undefsafe |

---

### 4. Optional / Peer Dependencies

The `ws` package lists the following as optional peer dependencies. They are not installed by default but can improve performance if present:

| Package | Purpose |
|---------|---------|
| `bufferutil` | Native WebSocket buffer utilities (performance) |
| `utf-8-validate` | Native UTF-8 validation (performance) |

---

### 5. Infrastructure / Container Components

| Component | Version | License | Description |
|-----------|---------|---------|-------------|
| Docker Engine | ≥ 20.x | Apache 2.0 | Container runtime for mock LPARs |
| Docker Compose | v2 | Apache 2.0 | Multi-container orchestration for mock LPAR stack |
| Ubuntu | 24.04 (LTS) | Various (GPL, etc.) | Base OS for Docker images and WSL2 environment |
| Node.js | ≥ 20.x | MIT | JavaScript runtime |

---

### 6. Browser Client — No Build-Time Dependencies

`tn3270-client.html` is a self-contained single-file browser application. It uses:

- Vanilla JavaScript (ES2020+) — no bundler, no framework
- Browser-native WebSocket API
- CSS custom properties for theming and cell sizing

No npm packages are shipped to the browser. All terminal emulation, screen buffer management, TN3270 data stream parsing, and AI Copilot integration run in plain JS loaded directly from the HTML file.

---

## Protocol and Standards References

These are not software dependencies but are foundational specifications implemented by this project:

| Standard | Description |
|----------|-------------|
| RFC 2355 | TN3270E — Extensions to TN3270 (IETF) |
| RFC 854 / 855 | Telnet Protocol Specification and Option Negotiation |
| IBM GA23-0059 | 3270 Data Stream Programmer's Reference |
| IBM CP037 / CP500 | EBCDIC codepages used for mainframe character encoding |
| SNA/VTAM | IBM Systems Network Architecture (VTAM terminal definitions) |

---

## License Summary

| License | Count | Packages |
|---------|-------|---------|
| MIT | 22 | `ws`, `nodemon`, `balanced-match`, `binary-extensions`, `brace-expansion`, `braces`, `chokidar`, `debug`, `fill-range`, `has-flag`, `is-binary-path`, `is-extglob`, `is-glob`, `is-number`, `ms`, `normalize-path`, `picomatch`, `readdirp`, `simple-update-notifier`, `supports-color`, `to-regex-range`, `undefsafe` |
| ISC | 4 | `anymatch`, `glob-parent`, `ignore-by-default`, `touch`, `semver` |
| BlueOak-1.0.0 | 1 | `minimatch` |

All dependency licenses are permissive and compatible with this project's MIT license.

---

## Security Notes

- All package integrity hashes are recorded in `Bridge_server/package-lock.json` (lockfileVersion 3).
- `ws` 8.20.0 is the production-critical package; monitor for CVEs via `npm audit`.
- No packages with known vulnerabilities are present as of the generation date above.
- Dev dependencies are excluded from production Docker images.

---

*This SBOM was generated manually from `Bridge_server/package.json` and `Bridge_server/package-lock.json`. For a machine-readable SBOM, consider generating CycloneDX JSON via `npx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json`.*

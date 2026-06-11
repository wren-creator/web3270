# Security Policy

## Scope

WebTerm/3270 is an open-source internal tooling project. It is a WebSocket-to-TN3270(E) bridge — it does not store credentials, does not process customer data, and does not expose a public-facing service by default. All TN3270 sessions run between the bridge server and a mainframe LPAR on your own network.

---

## Reporting a Vulnerability

If you discover a security issue in this project, please report it privately rather than opening a public GitHub issue.

**Contact:** Open a [GitHub Security Advisory](https://github.com/wren-creator/webterm-3270/security/advisories/new) on this repository.

You can expect an acknowledgement within a few business days. If a fix is warranted, a patched release will be published and the advisory will be made public once the fix is available.

---

## Security design notes

### Credentials

- TN3270 session credentials (mainframe username and password) are typed directly into the terminal screen by the user and transmitted to the mainframe over the existing TCP/TLS connection. They are not handled, logged, or stored by the bridge.
- AI provider API keys entered in the ⚙ AI tab are held **in browser memory only** and are never written to disk, sent to the bridge, or logged.
- Credentials must never be stored in macro JSON files (`macros.json`). The macro engine sends typed text to the terminal; any macro containing a password would expose it in plaintext on disk.
- NONDISPLAY fields (password fields) are masked at the TN3270 protocol layer before screen content is rendered or sent to the AI Assist panel.

### Network

- The bridge server (`server.js`) binds to `0.0.0.0` by default. In a shared environment, restrict this to `127.0.0.1` via the `BRIDGE_PORT` binding or a firewall rule.
- TLS verification for mainframe connections is enabled by default (`BRIDGE_VERIFY_TLS=true`). Only set this to `false` in isolated development environments.
- The `/api/profiles` and `/api/macros` REST endpoints have no authentication. They should not be exposed beyond localhost or a trusted internal network.

### Dependencies

- Production runtime dependency: `ws` (WebSocket library) only.
- Dev dependency: `nodemon`.
- Run `npm audit` regularly to check for known CVEs in dependencies.
- All package integrity hashes are recorded in `package-lock.json`.

### Docker

- The bridge process inside the container runs as a non-root user.
- `lpars.txt` and `macros.json` are bind-mounted from the host. Ensure host file permissions are appropriate (`chmod 666` is sufficient for single-user dev; tighten for shared deployments).
- Do not commit `.env` to version control — use `.env.example` as a template.

---

## Supported Versions

This project is in active development. Security fixes are applied to the current `main` branch. There are no versioned release tracks at this time.

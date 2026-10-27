# Roadmap

## Security Hardening (October 2026 audit of web3270, webterm-3270-saas, iplxec-toolkit, stock-alarm-service)
Done:
- [x] MCP server deps patched (`Bridge_server/mcp/`): zod bumped to 4.6.7 in `package.json`. The rest of that folder's advisories (proxy-addr, MCP SDK, body-parser, fast-uri and friends) were fixed in its lockfile, but `package-lock.json` is gitignored in this repo, so they only land on a fresh `npm install`. `npm audit` is clean.

Still to do, in rough priority order:
- [ ] WebSocket Origin check. The bridge has no login, so any web page you visit can open a socket to a bridge running on localhost and drive it. `Bridge_server/server.js` builds `WebSocketServer({ server })` with no `verifyClient`. Port `auth/ws-origin.js` from webterm-3270-saas (same host, an allowlist env var, no-Origin scripts pass, 403 otherwise).
- [ ] Bridge port is published on every interface: `docker-compose.yml` maps `"${BRIDGE_HOST_PORT:-8081}:8081"`. Default it to `127.0.0.1:` with an env override for people who really want it on the network. (The app itself binds `0.0.0.0`, which is right inside a container, so the fix is the port mapping, not `server.js`.)
- [ ] `Access-Control-Allow-Origin: *` is sent by 21 files under `Bridge_server/`. `config.bridge.corsOrigin` exists but defaults to `*`. Route everything through it and default it to the page's own origin.
- [ ] Bump `node:20-alpine` in `Bridge_server/Dockerfile`, which is out of support, and set `engines.node` to what actually runs (`>=18` today).
- [ ] Dependabot (`.github/dependabot.yml`) skips `/Bridge_server/mcp`. Add npm coverage for it.

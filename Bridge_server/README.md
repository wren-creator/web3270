# WebTerm/3270 Bridge

A WebSocket ↔ TN3270(E)/TN5250 bridge: browsers speak WebSocket to this
server, which holds the real Telnet connection to a mainframe LPAR or
AS/400 and translates 3270/5250 datastream to/from JSON screen updates.
Includes a security-tooling suite (MITM intercept, fuzzing, traffic/pcap
capture, object/authority scanners) and a set of mock LPAR/AS400/z-VM/TPF
daemons for demos and local testing without real host access.

## Quick start (local, Docker/Podman)

```bash
./start.sh
```

First run prompts for a UI port (default `8081`) and writes `.env`. It then
brings up the bridge plus the four mock hosts (`mock-lpar`, `mock-zvm`,
`mock-tpf`, `mock-as400`) via `docker-compose.yml`. Reconfigure the port
with `./start.sh --setup`, stop everything with `./stop.sh`.

Open `http://localhost:8081` (or `/demo` for the mock-host walkthrough).

`lpars.txt` and `ssh-hosts.txt` hold your connection profiles — gitignored,
editable from the UI or by hand; `lpars.shipped.txt`/`ssh-hosts.shipped.txt`
are the tracked built-in demo entries merged in underneath them.

## Running without Docker

```bash
npm install
node server.js
```

Configuration is environment-variable driven — see `config.js` and
`.env.example`.

## Project layout

| Path | What's there |
|---|---|
| `server.js`, `handlers/` | HTTP + WebSocket entry points |
| `tn3270/`, `tn5250/` | Protocol engines (session state machine, EBCDIC) |
| `routes/` | HTTP API endpoints (profiles, macros, recording, security tools, `/health`) |
| `features/` | MITM intercept, fuzzing, traffic/pcap capture, IND$FILE transfer, SSH |
| `macros/` | Macro record/replay engine and storage |
| `copilot/` | LLM copilot panel/handler |
| `mock-lpar/` | TN3270/TN5250 mock hosts for demos and testing (see `mock-lpar/README.md`) |
| `openshift/` | OpenShift deployment manifests (see below) |

## Deploying to OpenShift

See [`openshift/README.md`](openshift/README.md) for the full deploy guide.
Summary:

```bash
oc project <your-project>
oc apply -k openshift/
```

Two things to know going in:

- **Session affinity is required.** Each WebSocket session lives in the
  memory of one pod (it holds the live TCP socket to the mainframe/AS400),
  and the HTTP recording endpoints (`/api/recording/*`) are separate
  requests keyed by that same in-memory session — they need to land on the
  same pod. `openshift/bridge-route.yaml` enables cookie-based affinity for
  this; don't switch that Route to passthrough TLS termination, which
  breaks it.
- **Scaling past one replica needs ReadWriteMany storage.** `lpars.txt`,
  `ssh-hosts.txt`, and saved macros are user-editable at runtime; every pod
  needs to see the same copy. `openshift/bridge-pvc.yaml` requests RWX —
  swap to RWO and stay at `replicas: 1` if your cluster doesn't offer it.

Before applying, build/push the five images referenced in the manifests
(bridge + 4 mocks) and set a real `SECURITY_TOOLS_PASSWORD` instead of the
committed placeholder — details in `openshift/README.md`.

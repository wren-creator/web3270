# WebTerm/3270 Bridge — Windows Setup Guide

Two ways to run the bridge on Windows. Pick one.

> **Port reference:** The HTTP server (serving the browser UI and REST API) listens on **:8080**.
> The WebSocket bridge listens on **:8081**. Both must be reachable from the browser.

---

## Option A — WSL2 Ubuntu (recommended for VPN users)

WSL2 shares the Windows network stack, so corporate VPN routing to your
mainframe works without any special configuration.

### 1 · Install WSL2 if you haven't already

Open PowerShell as Administrator:

```powershell
wsl --install          # installs Ubuntu by default
wsl --set-default-version 2
```

Reboot if prompted, then open the Ubuntu app from the Start menu.

### 2 · Install Node.js 20 inside WSL2

```bash
# Inside Ubuntu terminal
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version    # should be v20.x.x
npm --version
```

### 3 · Clone / copy the bridge files

```bash
# Option 1: copy from Windows filesystem
cp -r /mnt/c/Users/YourName/Downloads/Bridge_server ~/Bridge_server

# Option 2: git clone
# git clone https://github.com/wren-creator/webterm-3270 ~/Bridge_server
```

### 4 · Install dependencies and configure

```bash
cd ~/Bridge_server
npm install

# Copy the example env file and edit it
cp .env.example .env
nano .env
```

Edit `.env` with your actual mainframe hostnames and ports:

```bash
PROD01_HOST=your-mainframe.corp.com
PROD01_PORT=992
PROD01_TLS=true
DEV02_HOST=dev-mf.corp.com
DEV02_PORT=23
DEV02_TLS=false
```

### 5 · Create required bind-mount files

These must exist as files (not directories) before starting:

```bash
touch macros.json lpars.txt
echo '[]' > macros.json
echo '# id, name, host/IP, port, tls, type, model' > lpars.txt
```

### 6 · Run the bridge

```bash
node server.js
# or use the provided start script:
bash start.sh
```

You should see:
```
─────────────────────────────────────────────────────
  WebTerm/3270 bridge ready
  Client (production) → http://localhost:8080
  Client (demo)       → http://localhost:8080/demo
  API profiles        → http://localhost:8080/api/profiles
  WebSocket bridge    → ws://localhost:8081
─────────────────────────────────────────────────────
```

### 7 · Connect the browser UI

Open `http://localhost:8080` in any browser.
Use the LPAR dropdown or **New Session…** (Ctrl+T) to connect.

### 8 · Auto-start on Windows boot (optional)

Create a Windows Task Scheduler entry that runs this on login:

```powershell
# Run in PowerShell as Administrator
$action  = New-ScheduledTaskAction -Execute "wsl.exe" `
             -Argument "-d Ubuntu -- bash -c 'cd ~/Bridge_server && node server.js >> ~/Bridge_server/bridge.log 2>&1'"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "TN3270 Bridge" -Action $action -Trigger $trigger -RunLevel Highest
```

---

## Option B — Docker Desktop (Windows)

Better if you want an isolated container you can start/stop from the
Docker Desktop UI, or plan to deploy the same image to a server later.

### Known limitation with VPN

Docker Desktop runs inside a lightweight Linux VM. Many corporate VPN
clients (Cisco AnyConnect, GlobalProtect, Pulse) do **not** route traffic
into the Docker VM by default. If your mainframe is only reachable over
VPN, use Option A (WSL2) instead, or ask your network team about
split-tunnel rules for the Docker bridge subnet (usually 172.17.0.0/16).

### 1 · Install Docker Desktop

Download from https://www.docker.com/products/docker-desktop/
Enable WSL2 backend during setup (recommended over Hyper-V).

### 2 · Copy bridge files to a Windows folder

```
C:\tools\Bridge_server\
  ├── server.js
  ├── config.js
  ├── logger.js
  ├── package.json
  ├── Dockerfile
  ├── docker-compose.yml
  ├── .dockerignore
  ├── lpars.txt          ← must exist as a file
  ├── macros.json        ← must exist as a file
  ├── tn3270\
  │   ├── session.js
  │   └── ebcdic.js
  ├── copilot\
  ├── macros\
  └── public\
```

### 3 · Edit docker-compose.yml

Open `docker-compose.yml` in any text editor and set your LPAR details:

```yaml
environment:
  PROD01_HOST: "your-mainframe.corp.com"
  PROD01_PORT: "992"
  PROD01_TLS:  "true"
  DEV02_HOST:  "dev-mf.corp.com"
  DEV02_PORT:  "23"
```

### 4 · Build and start

Open PowerShell or Windows Terminal in the bridge folder:

```powershell
cd C:\tools\Bridge_server

# Build the image
docker compose build

# Start (detached — runs in background)
docker compose up -d

# Check it started cleanly
docker compose logs -f
```

You should see:
```
tn3270-bridge  | WebTerm/3270 bridge ready
tn3270-bridge  | Client (production) → http://localhost:8080
tn3270-bridge  | WebSocket bridge    → ws://localhost:8081
```

### 5 · Connect the browser UI

Open `http://localhost:8080` in any browser.

### 6 · Useful Docker commands

```powershell
# Stop the bridge
docker compose down

# Rebuild after editing server.js or any Bridge_server/ source file
docker compose build --no-cache && docker compose up -d

# Restart after editing docker-compose.yml env vars only
docker compose up -d

# Reload lpars.txt or macros.json (bind-mounted — no rebuild needed)
# Just edit the file; changes are live immediately.

# View live logs
docker compose logs -f tn3270-bridge

# Confirm which code version is actually running
docker compose exec tn3270-bridge grep -c "some-unique-string" /app/server.js

# Get a shell inside the container (for debugging)
docker compose exec tn3270-bridge sh

# Enable hex dump of TN3270 data stream (noisy — disable after capture)
# Set TN3270_HEXDUMP: "1" in docker-compose.yml environment, then:
docker compose up -d   # no rebuild needed for env-only changes
```

---

## Choosing the right port for each LPAR

| Scenario | Port | TLS |
|----------|------|-----|
| Production mainframe (recommended) | 992 | ✅ yes |
| Dev/test LPAR, internal network | 23 | ❌ no |
| Custom TN3270 proxy or gateway | any | either |
| SSH tunnel (localhost relay) | any | ❌ no |

---

## Troubleshooting

**"Connection refused" on :8080 (UI) or :8081 (WebSocket)**
→ The bridge didn't start. Check `docker compose logs` or the Node console.

**Browser can't reach http://localhost:8080 (Docker)**
→ Confirm port 8080 isn't blocked by Windows Firewall.
  Run: `netstat -an | findstr 8080`

**Bridge connects but mainframe refuses**
→ Test raw connectivity first from inside WSL2 or the container:
  `nc -zv your-mainframe.corp.com 992`
  If that fails, it's a network/VPN routing issue, not the bridge.

**"CERT_HAS_EXPIRED" or TLS errors**
→ Set `BRIDGE_VERIFY_TLS=false` temporarily to confirm,
  then get the correct CA certificate from your mainframe team
  and mount it via the `volumes` section in docker-compose.yml.

**VPN connected but Docker can't reach mainframe**
→ Switch to Option A (WSL2 native Node). VPN + Docker Desktop is a
  known pain point on Windows.

**Connecting to GIBSON on the same WSL2 host**
→ If GIBSON is also running in Docker Compose on the same WSL2 instance,
  do not use `localhost` or `host.docker.internal` as the LPAR hostname —
  these are unreliable across separate compose stacks on WSL2. Both repos
  share a Docker network (`gibson-net`). Start GIBSON first, then start
  the bridge. Use `gibson-mainframe` as the hostname and `3270` as the port.

**macros.json or lpars.txt created as directories by Docker**
→ Run `docker compose down`, then on the host:
  ```bash
  rm -rf macros.json lpars.txt
  echo '[]' > macros.json
  echo '# id, name, host, port, tls, type, model' > lpars.txt
  chmod 666 macros.json lpars.txt
  docker compose up -d
  ```

**macros.json EACCES permission error**
→ `chmod 666 macros.json` on the host file. The bridge process inside
  the container runs as a non-root user and must be able to write to it.

**Stale code running after rebuild**
→ `docker compose down` first, then `docker compose build --no-cache && docker compose up -d`.
  Layer caching can persist stale state. If still wrong, do a full
  Docker Desktop restart to flush serving state.

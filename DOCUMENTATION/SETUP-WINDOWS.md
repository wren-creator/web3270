# WebTerm/3270 Bridge — Windows Setup Guide

Two ways to run the bridge on Windows. Pick one.

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
cp -r /mnt/c/Users/YourName/Downloads/tn3270-bridge ~/tn3270-bridge

# Option 2: git clone if you've pushed it somewhere
# git clone https://github.com/yourorg/tn3270-bridge ~/tn3270-bridge
```

### 4 · Install dependencies and configure

```bash
cd ~/tn3270-bridge
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

### 5 · Run the bridge

```bash
node server.js
# or, with env file:
set -a && source .env && set +a && node server.js
```

You should see:
```
2024-xx-xx [INFO ] WebTerm/3270 bridge listening on ws://0.0.0.0:8080
```

### 6 · Connect the browser UI

Open the WebTerm/3270 HTML file in any browser.
In the "New Session" dialog, connect to:  `ws://localhost:8080`

### 7 · Auto-start on Windows boot (optional)

Create a Windows Task Scheduler entry that runs this on login:

```powershell
# Run in PowerShell as Administrator
$action  = New-ScheduledTaskAction -Execute "wsl.exe" `
             -Argument "-d Ubuntu -- bash -c 'cd ~/tn3270-bridge && node server.js >> ~/tn3270-bridge/bridge.log 2>&1'"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "TN3270 Bridge" -Action $action -Trigger $trigger -RunLevel Highest
```

---

## Option B — Docker Desktop (Windows)

Better if you want an isolated container you can start/stop from the
Docker Desktop UI, or plan to deploy the same image to a server later.

### Known limitation with VPN
Docker Desktop runs inside a lightweight Linux VM.  Many corporate VPN
clients (Cisco AnyConnect, GlobalProtect, Pulse) do **not** route traffic
into the Docker VM by default.  If your mainframe is only reachable over
VPN, use Option A (WSL2) instead, or ask your network team about
split-tunnel rules for the Docker bridge subnet (usually 172.17.0.0/16).

### 1 · Install Docker Desktop

Download from https://www.docker.com/products/docker-desktop/
Enable WSL2 backend during setup (recommended over Hyper-V).

### 2 · Copy bridge files to a Windows folder

```
C:\tools\tn3270-bridge\
  ├── server.js
  ├── config.js
  ├── logger.js
  ├── package.json
  ├── Dockerfile
  ├── docker-compose.yml
  ├── .dockerignore
  └── tn3270\
      ├── session.js
      └── ebcdic.js
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
cd C:\tools\tn3270-bridge

# Build the image
docker compose build

# Start (detached — runs in background)
docker compose up -d

# Check it started cleanly
docker compose logs -f
```

You should see:
```
tn3270-bridge  | 2024-xx-xx [INFO ] WebTerm/3270 bridge listening on ws://0.0.0.0:8080
```

### 5 · Connect the browser UI

Open the WebTerm/3270 HTML file.
Connect to: `ws://localhost:8080`

### 6 · Useful Docker commands

```powershell
# Stop the bridge
docker compose down

# Restart after editing docker-compose.yml
docker compose up -d --force-recreate

# View live logs
docker compose logs -f tn3270-bridge

# Get a shell inside the container (for debugging)
docker exec -it tn3270-bridge sh

# Check resource usage
docker stats tn3270-bridge
```

---

## Choosing the right port for each LPAR

The bridge supports a **different host and port per session** — set them
either in `docker-compose.yml` (for named profiles) or type them directly
in the browser UI's "New Session" dialog.

| Scenario                            | Port | TLS    |
|-------------------------------------|------|--------|
| Production mainframe (recommended)  | 992  | ✅ yes |
| Dev/test LPAR, internal network     | 23   | ❌ no  |
| Custom TN3270 proxy or gateway      | any  | either |
| SSH tunnel (localhost relay)        | any  | ❌ no  |

---

## Troubleshooting

**"Connection refused" on :8080**
→ The bridge didn't start. Check `docker compose logs` or the Node console.

**Browser can't reach ws://localhost:8080 (Docker)**
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

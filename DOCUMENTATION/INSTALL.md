# WebTerm/3270 — Installation Guide

Two fully supported deployment options:

- **Option A — WSL2** — run directly in Ubuntu on Windows. Best for individual developers with direct IP access to mainframe LPARs.
- **Option B — Docker Desktop** — containerised image you can share across the team. Best for standardised team deployments.

Both options result in the same bridge running on `ws://localhost:8080`, accessible from any browser on the same Windows machine.

---

## Prerequisites (both options)

- Windows 10 version 2004+ or Windows 11
- Network access to your LPAR controller (port 339 from your Windows desktop)
- Administrator rights on your Windows machine (for initial setup only)

Verify mainframe connectivity before starting — open PowerShell and run:

```powershell
Test-NetConnection -ComputerName 10.x.x.x -Port 339
```

You should see `TcpTestSucceeded : True`. If not, stop here and check with your network team before continuing.

---

---

# Option A — WSL2 (Ubuntu)

## Step 1 · Enable WSL2

Open **PowerShell as Administrator** (right-click Start → Windows PowerShell (Admin)):

```powershell
# Install WSL2 with Ubuntu (default)
wsl --install

# Ensure WSL2 is the default version
wsl --set-default-version 2
```

**Reboot your machine when prompted.**

After rebooting, Ubuntu will open automatically and ask you to create a Linux username and password. Choose anything — this is your local Linux account, not your Windows or mainframe credentials.

Verify WSL2 is running correctly:

```powershell
wsl --list --verbose
```

You should see `Ubuntu` listed with `VERSION 2`.

---

## Step 2 · Update Ubuntu and install Node.js

Open the **Ubuntu** app from the Start menu (or search "Ubuntu"):

```bash
# Update package lists and upgrade existing packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 (LTS) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version    # should show v20.x.x
npm --version     # should show 10.x.x
```

---

## Step 3 · Copy the bridge files into WSL2

You have two options depending on where the project files are:

**From a Windows folder (e.g. Downloads):**

```bash
# Copy from Windows filesystem into your WSL2 home directory
cp -r /mnt/c/Users/YourWindowsUsername/Downloads/tn3270-bridge ~/tn3270-bridge
```

Replace `YourWindowsUsername` with your actual Windows username. Your Windows `C:\` drive is mounted at `/mnt/c/` inside WSL2.

**Via Git (if the project is in a repository):**

```bash
# Install git if not already present
sudo apt-get install -y git

git clone https://github.com/yourorg/tn3270-bridge ~/tn3270-bridge
```

---

## Step 4 · Configure your LPAR profiles

```bash
cd ~/tn3270-bridge

# Create your local config from the example template
cp .env.example .env

# Edit it — nano is the simplest editor
nano .env
```

Update the following values with your actual LPAR details:

```bash
# Bridge listener port — leave as 8080 unless something else is using it
BRIDGE_PORT=8080

# PROD01 LPAR
PROD01_HOST=10.x.x.x        # ← your actual LPAR controller IP
PROD01_PORT=339
PROD01_TLS=false

# DEV02 LPAR
DEV02_HOST=10.x.x.x         # ← can be the same IP with different LU routing
DEV02_PORT=339
DEV02_TLS=false

# QA01 LPAR
QA01_HOST=10.x.x.x
QA01_PORT=339
QA01_TLS=false
```

Save and exit nano: **Ctrl+O**, **Enter**, **Ctrl+X**.

---

## Step 5 · Install dependencies

```bash
cd ~/tn3270-bridge
npm install
```

This installs the `ws` WebSocket library — the only runtime dependency. You should see output ending in `added 1 package`.

---

## Step 6 · Run the bridge

```bash
cd ~/tn3270-bridge
node server.js
```

You should see:

```
2024-xx-xx [INFO ] WebTerm/3270 bridge listening on ws://0.0.0.0:8080
```

The bridge is now running. **Leave this terminal window open** — closing it stops the bridge.

---

## Step 7 · Open the client in your browser

In **Windows** (not inside WSL2), open any browser and open the client file:

```
C:\Users\YourWindowsUsername\Downloads\tn3270-bridge\public\tn3270-client.html
```

Or drag `tn3270-client.html` from File Explorer into your browser.

WSL2 automatically forwards `localhost` from Windows into the WSL2 instance, so the browser can reach `ws://localhost:8080` without any extra configuration.

Click **⊕ Connect to LPAR** in the top bar, select your LPAR from the dropdown, and connect.

---

## Step 8 · (Optional) Auto-start on Windows login

If you want the bridge to start automatically when you log into Windows, create a scheduled task.

Open **PowerShell as Administrator** and run:

```powershell
$action = New-ScheduledTaskAction `
  -Execute "wsl.exe" `
  -Argument "-d Ubuntu -- bash -c 'cd ~/tn3270-bridge && node server.js >> ~/tn3270-bridge/bridge.log 2>&1'"

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName "WebTerm3270 Bridge" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -RunLevel Highest `
  -Force
```

The bridge will now start silently in the background on every login.

To view the log:

```powershell
# From PowerShell on Windows
wsl cat ~/tn3270-bridge/bridge.log
```

To stop the auto-start task:

```powershell
Unregister-ScheduledTask -TaskName "WebTerm3270 Bridge" -Confirm:$false
```

---

## WSL2 Troubleshooting

**`node: command not found`**
→ Node.js didn't install correctly. Re-run the NodeSource install commands in Step 2.

**`EADDRINUSE: address already in use :8080`**
→ Something else is using port 8080. Change `BRIDGE_PORT=8081` in `.env` and refresh the browser connection URL.

**Bridge starts but browser can't connect**
→ WSL2 `localhost` forwarding occasionally breaks after Windows updates. Run this in PowerShell as Administrator:

```powershell
netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectport=8080 connectaddress=$(wsl hostname -I)
```

**`Connection refused` to mainframe**
→ Test from inside WSL2 directly:

```bash
# Install netcat if needed
sudo apt-get install -y netcat-openbsd

nc -zv 10.x.x.x 339
```

If this fails, the issue is network routing — not the bridge. Check Windows Firewall outbound rules for port 339.

**TLS certificate errors**
→ If your mainframe uses a self-signed certificate, set `BRIDGE_VERIFY_TLS=false` in `.env` temporarily to confirm, then obtain the correct CA certificate from your mainframe team.

---

---

# Option B — Docker Desktop

Docker Desktop packages the bridge in a container image that any team member can run identically on their own Windows machine without installing Node.js.

## Step 1 · Install Docker Desktop

1. Download Docker Desktop from **https://www.docker.com/products/docker-desktop/**
2. Run the installer. When asked, select **"Use WSL 2 instead of Hyper-V"** (recommended).
3. Reboot when prompted.
4. Open Docker Desktop from the Start menu. Wait for the whale icon in the system tray to show **"Docker Desktop is running"**.

Verify the installation in PowerShell:

```powershell
docker --version
docker compose version
```

Both commands should return version numbers without errors.

---

## Step 2 · Get the project files onto the team member's machine

Choose one of:

**Option 2a — shared network drive / USB / email:**

Copy the entire `tn3270-bridge` folder to:

```
C:\tools\tn3270-bridge\
```

The folder must contain at minimum:

```
tn3270-bridge\
├── server.js
├── config.js
├── logger.js
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── tn3270\
    ├── session.js
    └── ebcdic.js
```

**Option 2b — internal Git repository (recommended for teams):**

```powershell
# In PowerShell
git clone https://your-internal-git/tn3270-bridge C:\tools\tn3270-bridge
```

---

## Step 3 · Configure your LPAR profiles

Open `C:\tools\tn3270-bridge\docker-compose.yml` in any text editor (Notepad, VS Code, etc.) and update the `environment` section:

```yaml
environment:
  BRIDGE_PORT: "8080"
  LOG_LEVEL: "info"
  BRIDGE_VERIFY_TLS: "false"

  PROD01_HOST: "10.x.x.x"      # ← your actual LPAR controller IP
  PROD01_PORT: "339"
  PROD01_TLS:  "false"

  DEV02_HOST:  "10.x.x.x"
  DEV02_PORT:  "339"
  DEV02_TLS:   "false"

  QA01_HOST:   "10.x.x.x"
  QA01_PORT:   "339"
  QA01_TLS:    "false"
```

**Do not put real passwords or secrets in this file.** The bridge does not require mainframe credentials — authentication happens on the mainframe side after the TN3270 session is established.

---

## Step 4 · Build the Docker image

Open **PowerShell** (does not need to be Administrator) and navigate to the project folder:

```powershell
cd C:\tools\tn3270-bridge

# Build the image — this takes 1-2 minutes the first time
docker compose build
```

You should see output ending in:

```
[+] up 0/2
 - Image bridge_server-tn3270-bridge Building                                                                       2.2s
 - Image bridge_server-mock-lpar     Building  
```

The image is now built locally. You only need to rebuild if `server.js`, `config.js`, or `package.json` change.

---

## Step 5 · Start the bridge

```powershell
# Start in detached mode (runs in background)
docker compose up -d
```

You should now see.

```
[+] up 3/3
 ✔ Network bridge_server_tn3270-net Created                                                                         0.0s
 ✔ Container mock-lpar              Started                                                                         0.4s
 ✔ Container tn3270-bridge          Started
```

Verify it started cleanly:

```powershell
docker compose logs
```

You should see:

```
tn3270-bridge  | 2026-04-08T10:49:13.410Z [INFO ] ─────────────────────────────────────────────────────
mock-lpar      | 2026-04-08T10:49:13.342Z [INFO ] ─────────────────────────────────────────────────────
tn3270-bridge  | 2026-04-08T10:49:13.412Z [INFO ]   WebTerm/3270 bridge ready
tn3270-bridge  | 2026-04-08T10:49:13.412Z [INFO ]   Client (production) → http://localhost:8081
mock-lpar      | 2026-04-08T10:49:13.348Z [INFO ]   WebTerm/3270 Mock LPAR Daemon
mock-lpar      | 2026-04-08T10:49:13.348Z [INFO ]   Listening on  tcp://0.0.0.0:3270
mock-lpar      | 2026-04-08T10:49:13.348Z [INFO ]   System ID     DEMOSYS
mock-lpar      | 2026-04-08T10:49:13.348Z [INFO ]   LU Name       MOCKLU01
mock-lpar      | 2026-04-08T10:49:13.348Z [INFO ]   Protocol      TN3270E + classic TN3270 fallback
mock-lpar      | 2026-04-08T10:49:13.349Z [INFO ]   Screens       Logon → ISPF → Edit / SDSF
mock-lpar      | 2026-04-08T10:49:13.349Z [INFO ] ─────────────────────────────────────────────────────
mock-lpar      | 2026-04-08T10:49:13.349Z [INFO ]   Connect the bridge: MOCK_HOST=127.0.0.1 MOCK_PORT=3270
mock-lpar      | 2026-04-08T10:49:13.349Z [INFO ]   Or add to .env:     PROD01_HOST=127.0.0.1 PROD01_PORT=3270
mock-lpar      | 2026-04-08T10:49:13.349Z [INFO ] ─────────────────────────────────────────────────────
tn3270-bridge  | 2026-04-08T10:49:13.412Z [INFO ]   Client (demo)       → http://localhost:8081/demo
tn3270-bridge  | 2026-04-08T10:49:13.412Z [INFO ]   WebSocket bridge    → ws://localhost:8081
tn3270-bridge  | 2026-04-08T10:49:13.412Z [INFO ] ─────────────────────────────────────────────────────
```

Check the status

```powershell
docker compose ps
```

you should see the following.

```
NAME            IMAGE                         COMMAND                  SERVICE         CREATED         STATUS                     PORTS
mock-lpar       bridge_server-mock-lpar       "docker-entrypoint.s…"   mock-lpar       2 minutes ago   Up 2 minutes               3270/tcp
tn3270-bridge   bridge_server-tn3270-bridge   "docker-entrypoint.s…"   tn3270-bridge   2 minutes ago   Up 2 minutes (unhealthy)   0.0.0.0:8081->8081/tcp, [::]:8081->8081/tcp
```

---

## Step 6 · Open the client in your browser

Navigate to the following address in your browser, setting the port to what you set.

```
http://localhost:8081
```

Click **⊕ Connect to LPAR**, select your LPAR, and connect.

---

## Step 7 · Useful day-to-day Docker commands

```powershell
# Stop the bridge
docker compose down

# Start the bridge
docker compose up -d

# View live logs (Ctrl+C to stop watching)
docker compose logs -f

# Restart after changing docker-compose.yml
docker compose up -d --force-recreate

# Get a shell inside the container (for debugging)
docker exec -it tn3270-bridge sh

# Check memory and CPU usage
docker stats tn3270-bridge

# Remove the container and image entirely (to start fresh)
docker compose down --rmi all
```

---

## Step 8 · (Optional) Share a pre-built image with the team

Instead of each team member building the image themselves, you can build once and push to an internal registry.

**Using Docker Hub (private repo) or an internal registry:**

```powershell
# Tag the image
docker tag tn3270-bridge your-registry.corp.com/tn3270-bridge:latest

# Push it
docker push your-registry.corp.com/tn3270-bridge:latest
```

Team members then update `docker-compose.yml` to pull the image instead of building:

```yaml
services:
  tn3270-bridge:
    image: your-registry.corp.com/tn3270-bridge:latest
    # remove the 'build:' section entirely
```

And run:

```powershell
docker compose pull
docker compose up -d
```

**Using a tar file (no registry needed):**

```powershell
# On the build machine — export the image to a file
docker save tn3270-bridge | gzip > tn3270-bridge.tar.gz

# On the team member's machine — load the image
docker load < tn3270-bridge.tar.gz
docker compose up -d
```

---

## Step 9 · Auto-start Docker container on Windows login

In Docker Desktop:

1. Click the **gear icon** (Settings) in the top right
2. Go to **General**
3. Enable **"Start Docker Desktop when you log in"**
4. Click **Apply & Restart**

Then set the container to always restart:

The `docker-compose.yml` already includes `restart: unless-stopped`, so once the container has been started with `docker compose up -d`, it will automatically restart after reboots and after Docker Desktop starts.

---

## Connecting to GIBSON

If you are using [GIBSON](https://github.com/wren-creator/GIBSON) as your TN3270 target alongside the web3270 bridge, both compose stacks are configured to share a Docker network called `gibson-net`. This lets the bridge reach GIBSON directly by container name without any host routing — and works identically on Linux, WSL2 on Windows, and macOS.

**Why this matters on WSL2:** Each Docker Compose stack gets its own isolated network by default. Routing between stacks through the host (`host.docker.internal`) is unreliable on WSL2. The shared network sidesteps that entirely.

**Startup order:**

```bash
# 1 · Start GIBSON first — it creates the gibson-net network
cd /path/to/GIBSON/gibson-mainframe
docker compose up -d

# 2 · Start the web3270 bridge — it joins gibson-net automatically
cd /path/to/web3270/Bridge_server
docker compose up -d
```

**LPAR entry** — add this line to `lpars.txt` (or add it via the web UI):

```
gibson, GIBSON, gibson-mainframe, 3270, false, TSO, 3278-2
```

`gibson-mainframe` is the GIBSON container name. Docker resolves it over the shared network — no IP address or DNS configuration required.

**If you start the bridge before GIBSON:** The bridge will start fine but connections to `gibson-mainframe` will fail until GIBSON is up. Just start GIBSON and retry the connection.

---

## Docker Troubleshooting

**`docker: command not found`**
→ Docker Desktop isn't installed or PATH isn't set. Restart PowerShell after installing Docker Desktop.

**`error during connect: ... pipe/docker_engine`**
→ Docker Desktop isn't running. Open Docker Desktop from the Start menu and wait for it to fully start (whale icon in system tray turns solid).

**Container starts then immediately exits**
→ Check the logs: `docker compose logs`. Usually a misconfigured environment variable in `docker-compose.yml`.

**Browser can't reach `ws://localhost:8080`**
→ Confirm the port mapping in `docker compose ps`. If the port shows as `0.0.0.0:8080->8080/tcp` the container is listening. Check Windows Firewall isn't blocking localhost loopback on 8080.

**Bridge can't reach the mainframe from Docker**
→ This is the most common Docker-specific issue. Docker Desktop uses a virtual network. Test from inside the container:

```powershell
docker exec -it tn3270-bridge sh -c "nc -zv 10.x.x.x 339"
```

If this fails but the same test works from WSL2 or PowerShell, your corporate network/VPN is not routing into the Docker VM. In this case, switch to **Option A (WSL2)**.

**Image build fails with network errors**
→ Docker may be behind a corporate proxy. Add to `docker-compose.yml` under the `build:` section:

```yaml
build:
  context: .
  args:
    HTTP_PROXY: "http://proxy.corp.com:8080"
    HTTPS_PROXY: "http://proxy.corp.com:8080"
```

---

---

# Choosing between WSL2 and Docker

| | WSL2 | Docker Desktop |
|---|---|---|
| Setup time | ~10 minutes | ~15 minutes |
| Node.js required on host | Yes | No |
| Works reliably with direct IP access | ✅ Yes | ✅ Yes |
| Shareable identical image for team | Manual (git clone) | ✅ Yes (tar or registry) |
| Auto-start on login | Via Task Scheduler | Via Docker Desktop setting |
| Resource usage | Low | Low (~150MB image) |
| Recommended for | Individual dev use | Team standardisation |

If everyone has direct IP to the LPAR controller (port 339) from their Windows desktop, either option works. Docker Desktop is better for ensuring the whole team runs identical configuration. WSL2 is simpler if you're the only user.

---

## Getting help

If the bridge connects but the mainframe rejects the session, the most useful diagnostic is to enable debug logging:

**WSL2:**

```bash
LOG_LEVEL=debug node server.js 2>&1 | tee bridge-debug.log
```

**Docker:**

```powershell
# Edit docker-compose.yml: set LOG_LEVEL: "debug"
docker compose up -d --force-recreate
docker compose logs -f
```

The debug log will show the full Telnet negotiation byte-by-byte, which makes it straightforward to identify whether the issue is TN3270E negotiation, LU assignment, or EBCDIC code page mismatch.

Share the log output with your mainframe team or open an issue in the project repository.

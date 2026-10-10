# WebTerm/3270: Installation Guide

WebTerm/3270 runs as a set of containers. That is the only supported way to run it, on Windows, Mac, and Linux. You don't install Node.js, you don't set up WSL, and you don't build anything unless you want to.

Pick one path:

- **Path 1, prebuilt images (start here).** Pull ready-made images, run one compose file, done in about two minutes.
- **Path 2, offline bundle.** Same images, delivered as a tar file for machines that can't reach the internet.
- **Path 3, build from source.** For contributors, or if you changed the code.

All three end the same way: the bridge on `http://localhost:8081`.

---

## Prerequisites

- **Docker Desktop** (Windows 10/11, macOS, Linux) or **Podman** with `podman-compose`.
  - Windows: download from https://www.docker.com/products/docker-desktop/ and accept the default WSL 2 backend. Docker Desktop uses WSL 2 internally, but you never open or configure it yourself.
  - Open Docker Desktop and wait until it says it is running.
- Network access from your machine to your LPAR (usually port 23, or 992 for TLS). Check before you start:

```powershell
# Windows PowerShell
Test-NetConnection -ComputerName 10.x.x.x -Port 23
```

```bash
# Mac / Linux
nc -zv 10.x.x.x 23
```

If that fails, stop here. It's a network or VPN problem, not a WebTerm problem. See [VPN users](#vpn-users).

Verify Docker is ready:

```bash
docker --version
docker compose version
```

---

## Path 1: Prebuilt images

Images are published to GitHub Container Registry for Intel/AMD and ARM (Apple Silicon, Raspberry Pi) on every release:

| Image | What it is |
|---|---|
| `ghcr.io/wren-creator/web3270-bridge` | The bridge and web client |
| `ghcr.io/wren-creator/web3270-mock-lpar` | Mock z/OS (TSO, ISPF, SDSF), port 3270 |
| `ghcr.io/wren-creator/web3270-mock-zvm` | Mock z/VM, port 3271 |
| `ghcr.io/wren-creator/web3270-mock-as400` | Mock AS/400 (5250), port 3272 |
| `ghcr.io/wren-creator/web3270-mock-claims` | Mock claims system, port 3273 |
| `ghcr.io/wren-creator/web3270-mock-tpf` | Mock z/TPF console, port 3274 |

### 1 · Get the compose file

```bash
curl -LO https://raw.githubusercontent.com/wren-creator/web3270/main/Bridge_server/docker-compose.prebuilt.yml
```

On Windows PowerShell use `curl.exe -LO ...` (plain `curl` is a PowerShell alias for something else), or just download the file from the repo in your browser.

### 2 · Start it

```bash
docker compose -f docker-compose.prebuilt.yml up -d
```

First run pulls the six images, then starts them. Check it:

```bash
docker compose -f docker-compose.prebuilt.yml ps
```

You want `tn3270-bridge` showing `Up ... (healthy)`.

### 3 · Open the client

```
http://localhost:8081
```

Click **⊕ Connect to LPAR**. The five `MOCK-*` entries work immediately, so you can see a real 3270 screen before you touch your own mainframe. To add yours, see [Adding your LPAR](#adding-your-lpar).

### Options

```bash
# Pin a release instead of tracking latest
WEB3270_TAG=1.0.0 docker compose -f docker-compose.prebuilt.yml up -d

# Use a different host port (8081 already taken)
BRIDGE_HOST_PORT=9000 docker compose -f docker-compose.prebuilt.yml up -d
```

PowerShell sets variables differently:

```powershell
$env:BRIDGE_HOST_PORT = "9000"
docker compose -f docker-compose.prebuilt.yml up -d
```

### Upgrade

```bash
docker compose -f docker-compose.prebuilt.yml pull
docker compose -f docker-compose.prebuilt.yml up -d
```

### Just the bridge, from the Docker Desktop UI

If you'd rather click than type: in Docker Desktop, search for `ghcr.io/wren-creator/web3270-bridge`, pull it, hit **Run**, expand **Optional settings**, and set the host port to `8081`. You get the bridge only, no mock mainframes, because those need the shared network the compose file creates. That's fine if you only want to reach a real LPAR.

---

## Path 2: Offline bundle (no internet on the Docker machine)

Each release on the [Releases page](https://github.com/wren-creator/web3270/releases) has:

- `web3270-images-<version>-amd64.tar.gz` for Intel/AMD machines (most Windows PCs)
- `web3270-images-<version>-arm64.tar.gz` for Apple Silicon and ARM
- `docker-compose.prebuilt.yml`

Copy those two files to the target machine (USB, file share, whatever your shop allows), then:

```bash
docker load < web3270-images-<version>-amd64.tar.gz
```

```powershell
# PowerShell has no < redirect for this, use -i
docker load -i web3270-images-<version>-amd64.tar.gz
```

Then start it, telling compose which version you loaded. The tarball name has a leading `v` (`v1.0.1`) but the image tag does not (`1.0.1`):

```bash
WEB3270_TAG=1.0.1 docker compose -f docker-compose.prebuilt.yml up -d
```

Compose uses the loaded images and only tries to pull what's missing, so nothing goes out to the internet. The loaded images also show up in Docker Desktop under **Images**.

---

## Path 3: Build from source

```bash
git clone https://github.com/wren-creator/web3270.git
cd web3270/Bridge_server

./start.sh          # Mac / Linux
.\start.ps1         # Windows PowerShell
```

First run asks which port to use (default 8081), creates the config files the containers mount, builds the images, and starts everything. Next time `./start.sh` just starts. `./start.sh --setup` reconfigures the port, `./stop.sh` shuts down.

Doing it by hand instead:

```bash
cd Bridge_server
cp .env.example .env
[ -f lpars.txt ] || echo '# id, name, host/IP, port, tls, type, model' > lpars.txt
cp -n ssh-hosts.txt.example ssh-hosts.txt
cp -n default-accounts.txt.example default-accounts.txt
docker compose build
docker compose up -d
```

Those three files **must exist as files** before `up`. If they don't, Docker silently creates *directories* at those paths and the bridge fails with confusing errors. `start.sh` does this for you.

Rebuild after changing code: `docker compose build && docker compose up -d`. Stale code after a rebuild: `docker compose down`, then `docker compose build --no-cache`, then `up -d`.

---

## Adding your LPAR

**From the UI (easiest).** Click **⊕ Connect to LPAR**, add a profile with host, port, TLS on/off, and type. Saved immediately, no restart.

**Persistence caveat for Path 1 and 2.** Profiles you add are saved inside the bridge container. They survive stop, start, and restart, but not `docker compose down`, which deletes the container. To keep them permanently, create two empty files next to the compose file and uncomment the two bind-mount lines in `docker-compose.prebuilt.yml`:

```bash
touch lpars.txt ssh-hosts.txt
```

```yaml
    volumes:
      - macros_data:/app/macros/local
      - ./lpars.txt:/app/lpars.txt          # uncomment
      - ./ssh-hosts.txt:/app/ssh-hosts.txt  # uncomment
```

**By file (Path 3).** Edit `Bridge_server/lpars.txt`:

```
# id, name, host/IP, port, tls, type, model, tn3270e
prod01,  PROD01,  10.80.1.1,  992,  true,   TSO,  3278-2,  true
dev01,   DEV01,   10.80.1.2,  23,   false,  TSO,  3278-2,  true
```

| Scenario | Port | TLS |
|---|---|---|
| Production mainframe (recommended) | 992 | yes |
| Dev/test LPAR, internal network | 23 | no |
| SSH tunnel / localhost relay | any | no |

Full column reference is in `lpars.txt.example`. No mainframe passwords are ever stored in these files. You sign on at the mainframe's own logon screen.

**Reaching something running on your own machine** (an emulator, a tunnel): use the hostname `host.docker.internal` as the LPAR host, not `localhost`. Inside a container, `localhost` is the container itself.

---

## Day-to-day commands

Use `-f docker-compose.prebuilt.yml` on each of these if you're on Path 1 or 2.

```bash
docker compose ps                       # status
docker compose logs -f tn3270-bridge    # live logs, Ctrl+C to stop watching
docker compose restart tn3270-bridge    # restart the bridge only
docker compose down                     # stop and remove containers
docker compose exec tn3270-bridge sh    # shell inside the bridge
docker stats tn3270-bridge              # CPU and memory
```

**Start on login.** Docker Desktop: Settings, General, enable *Start Docker Desktop when you log in*. Both compose files set `restart: unless-stopped`, so the containers come back by themselves after a reboot.

---

## Connecting to GIBSON

If you use [GIBSON](https://github.com/wren-creator/GIBSON) as a TN3270 target, both stacks share a Docker network called `gibson-net`, so the bridge reaches GIBSON by container name. No IP address, no `host.docker.internal`. (Routing between separate compose stacks through the host is unreliable, which is why they share a network.)

```bash
# 1 · Start GIBSON first, it creates gibson-net
cd /path/to/GIBSON/gibson-mainframe
docker compose up -d

# 2 · Start the bridge, it joins gibson-net automatically
cd /path/to/web3270/Bridge_server
docker compose up -d
```

This network wiring lives in the build-from-source compose file (Path 3). Add the LPAR in the UI or in `lpars.txt`:

```
gibson, GIBSON, gibson-mainframe, 3270, false, TSO, 3278-2
```

If you start the bridge before GIBSON, the bridge is fine but connections to `gibson-mainframe` fail until GIBSON is up. Start GIBSON and retry.

**Login screen goes blank as soon as you type:** make sure GIBSON's TN3270 listener on port 3270 is running. Its logs should show `IST001I TN3270 LISTENER ACTIVE ON PORT 3270`.

**Logs flooded with repeating `Telnet DONT TN3270E` lines:** a negotiation ping-pong with older GIBSON builds. Update both the bridge and GIBSON to the latest `main`.

---

## VPN users

Docker Desktop runs containers inside a small VM. Some VPN clients (AnyConnect, GlobalProtect, Pulse) don't carry that VM's traffic through the tunnel, so the container can't reach an LPAR that your laptop can.

Work down this list:

1. Confirm the host reaches the LPAR (the `Test-NetConnection` / `nc` check at the top). If it doesn't, the VPN itself is the problem.
2. Confirm the container can't: `docker compose exec tn3270-bridge sh -c "nc -zv 10.x.x.x 23"`.
3. If the host can and the container can't, ask your network team to include Docker's subnet (usually `172.17.0.0/16`) in the VPN's split-tunnel or allow rules.
4. Or run the containers on a machine or server that has a direct route to the LPAR, and browse to it from your desktop. One shared host also means the whole team runs identical config.

---

## Troubleshooting

**`docker: command not found`**
Docker Desktop isn't installed or your terminal predates the install. Close and reopen the terminal.

**`error during connect: ... pipe/docker_engine` or "daemon is not running"**
Docker Desktop isn't running. Start it and wait for the whale icon to settle.

**`Bind for 0.0.0.0:8081 failed: port is already allocated`**
Something else owns 8081. Set `BRIDGE_HOST_PORT=9000` (Path 1/2) or run `./start.sh --setup` (Path 3), then open the new port.

**`pull access denied` or `unauthorized` pulling from ghcr.io**
The images aren't public yet, or you typed the name wrong. Check the spelling, then check the package visibility on the repo's Packages page.

**Image runs but is slow or crashes on an Apple Silicon Mac**
You pulled the wrong architecture. Plain `docker compose pull` picks the right one automatically. If you loaded an offline bundle, use the `arm64` tarball.

**Container starts then exits**
`docker compose logs` shows why. Usually a bad environment variable or, on Path 3, a bind-mounted file that doesn't exist (see Path 3).

**Browser can't reach `http://localhost:8081`**
Check `docker compose ps` shows the port mapping and `(healthy)`. If it does, check Windows Firewall isn't blocking the port.

**Bridge can't reach the mainframe**
See [VPN users](#vpn-users).

**TLS certificate errors**
- `self-signed certificate in certificate chain`: Node doesn't trust the issuer. Get the CA cert from your mainframe team and point `NODE_EXTRA_CA_CERTS` at it. `BRIDGE_VERIFY_TLS=false` also makes the error go away, but it turns off verification for every outbound connection, so use it only to confirm the cert is the cause.
- `Hostname/IP does not match certificate's altnames`: the host in your profile (often an IP) isn't the DNS name on the cert. Set the `tlsServername` column (column 10) to the DNS name. See `lpars.txt.example`.

**`lpars.txt` or `ssh-hosts.txt` turned into a directory (Path 3)**
Docker made them when the files didn't exist. `docker compose down`, delete the directories, recreate them as files (see Path 3), `up -d`.

**EACCES writing `lpars.txt`**
The container runs as a non-root user. `chmod 666 lpars.txt ssh-hosts.txt` on the host.

**Build fails on `apk add ... krb5-dev` (Path 3 only)**
Your network blocks Alpine's package mirror, often an SSL-inspecting proxy. Prebuilt images (Path 1) sidestep this entirely, which is the easiest fix. If you must build, see the Debian-base workaround in the README troubleshooting section.

---

## Getting help

If the bridge connects but the mainframe rejects the session, collect diagnostics. From `Bridge_server/`:

```bash
./collect-logs.sh          # Mac / Linux
.\collect-logs.ps1         # Windows PowerShell
```

It gathers container logs and system info, then scrubs hostnames, IPs, macro field values, and userids before packaging a `webterm-diag-TIMESTAMP.zip` that is safe to share. A local `redaction-map-TIMESTAMP.txt` stays on your machine. Don't send that one.

Send the zip via Slack at **britleydev.slack.com** or email **britleyhoff@britleyhoffconsulting.com**.

For raw protocol debugging, set `TN3270_HEXDUMP: "1"` under the bridge's `environment:` and run `docker compose up -d`. No rebuild needed. It logs every TN3270 byte, so it's very noisy; turn it off when you're done.

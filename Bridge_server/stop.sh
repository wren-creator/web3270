#!/bin/bash
# stop.sh — graceful shutdown + erroneous container cleanup

set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'

info()  { echo -e "${CYAN}[stop]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[ok]${RESET}    $*"; }
bad()   { echo -e "${RED}[fail]${RESET}  $*"; }

echo ""
info "Stopping web3270 services…"

# ── 1. Graceful compose down ────────────────────────────────────────────────
if docker compose ps -q 2>/dev/null | grep -q .; then
  docker compose down --remove-orphans
  ok "Compose stack stopped."
else
  info "No compose stack running."
fi

# ── 2. Find erroneous containers (project or port-related) ─────────────────
echo ""
info "Scanning for erroneous containers…"
FOUND=0

# Exited/dead containers from this project
ERRORED=$(docker ps -a --filter "status=exited" --filter "status=dead" \
  --format '{{.ID}}\t{{.Names}}\t{{.Status}}' | \
  grep -E 'mock-lpar|mock-zvm|mock-tpf|tn3270-bridge' || true)

if [ -n "$ERRORED" ]; then
  warn "Found exited/dead project containers:"
  echo "$ERRORED" | while IFS=$'\t' read -r id name status; do
    warn "  $name ($id) — $status"
  done
  IDS=$(echo "$ERRORED" | awk '{print $1}')
  echo "$IDS" | xargs docker rm -f
  ok "Removed erroneous containers."
  FOUND=1
fi

# Containers holding our ports (3270, 3271, 3274, bridge port) that aren't ours
BRIDGE_PORT=$(grep '^BRIDGE_HOST_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
BRIDGE_PORT=${BRIDGE_PORT:-8081}
for PORT in 3270 3271 3274 "$BRIDGE_PORT"; do
  HOLDER=$(docker ps --format '{{.ID}}\t{{.Names}}\t{{.Ports}}' | \
    grep ":${PORT}->" | grep -v -E 'mock-lpar|mock-zvm|mock-tpf|tn3270-bridge' || true)
  if [ -n "$HOLDER" ]; then
    warn "Port $PORT held by unexpected container:"
    echo "$HOLDER" | while IFS=$'\t' read -r id name ports; do
      warn "  $name ($id) — $ports"
    done
    echo "$HOLDER" | awk '{print $1}' | xargs docker rm -f
    ok "Removed port-squatting container on :$PORT."
    FOUND=1
  fi
done

# Dangling / unnamed containers created from our images
DANGLING=$(docker ps -a --filter "status=created" \
  --format '{{.ID}}\t{{.Names}}\t{{.Image}}' | \
  grep -E 'bridge_server|mock' || true)

if [ -n "$DANGLING" ]; then
  warn "Found stuck 'created' containers:"
  echo "$DANGLING" | while IFS=$'\t' read -r id name image; do
    warn "  $name ($id) — $image"
  done
  echo "$DANGLING" | awk '{print $1}' | xargs docker rm -f
  ok "Removed stuck containers."
  FOUND=1
fi

# Restarting containers (crash-looping)
LOOPING=$(docker ps --filter "status=restarting" \
  --format '{{.ID}}\t{{.Names}}\t{{.Status}}' | \
  grep -E 'mock-lpar|mock-zvm|mock-tpf|tn3270-bridge' || true)

if [ -n "$LOOPING" ]; then
  warn "Found crash-looping containers:"
  echo "$LOOPING" | while IFS=$'\t' read -r id name status; do
    warn "  $name ($id) — $status"
  done
  echo "$LOOPING" | awk '{print $1}' | xargs docker rm -f
  ok "Removed crash-looping containers."
  FOUND=1
fi

[ "$FOUND" -eq 0 ] && ok "No erroneous containers found."

# ── 3. Orphaned tn3270-net attachments ────────────────────────────────────
echo ""
info "Checking tn3270-net for orphaned attachments…"
NET_CONTAINERS=$(docker network inspect tn3270-net \
  --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || true)

if [ -n "$NET_CONTAINERS" ]; then
  warn "Containers still attached to tn3270-net: $NET_CONTAINERS"
  for c in $NET_CONTAINERS; do
    docker network disconnect -f tn3270-net "$c" 2>/dev/null || true
    warn "  Disconnected: $c"
  done
  ok "Network cleared."
else
  ok "tn3270-net is clean."
fi

echo ""
ok "All done. Run ./start.sh to bring everything back up."
echo ""

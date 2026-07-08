#!/bin/bash
# WebTerm/3270 Bridge — start
# First run: prompts to configure port, then starts.
# Subsequent runs: starts immediately using saved config.
# Reconfigure:  ./start.sh --setup

# ── Detect container runtime (Docker or Podman) ───────────────────────────
if command -v docker &>/dev/null; then
  RUNTIME=docker
elif command -v podman &>/dev/null; then
  RUNTIME=podman
else
  echo "Error: neither docker nor podman found. Install Docker Desktop or Podman." >&2
  exit 1
fi

if $RUNTIME compose version &>/dev/null 2>&1; then
  COMPOSE="$RUNTIME compose"
elif command -v podman-compose &>/dev/null; then
  COMPOSE="podman-compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  echo "Error: no compose tool found. Install docker compose or podman-compose." >&2
  exit 1
fi

# ── Port configuration ─────────────────────────────────────────────────────
if [ "$1" = "--setup" ] || [ ! -f .env ]; then
  sh setup.sh
fi

# ── Seed required files ────────────────────────────────────────────────────
# These are bind-mounted into the container; if they don't exist, Docker would
# create a directory at the mount path instead of a file.
[ ! -f lpars.txt ] && echo '# id, name, host/IP, port, tls, type, model' > lpars.txt
[ ! -f ssh-hosts.txt ] && cp ssh-hosts.txt.example ssh-hosts.txt

# ── Migrate macros from old location if needed ────────────────────────────
mkdir -p macros/local
if [ -f macros/macros.json ] && [ ! -f macros/local/macros.json ]; then
  cp macros/macros.json macros/local/macros.json
  echo "Migrated macros to new location."
fi

# ── Start ──────────────────────────────────────────────────────────────────
PORT=$(grep '^BRIDGE_HOST_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT=${PORT:-8081}

$COMPOSE down 2>/dev/null || true

COMPOSE_ERR=$(mktemp)
if $COMPOSE up -d --build 2>"$COMPOSE_ERR"; then
  rm -f "$COMPOSE_ERR"
  echo ""
  echo "Bridge started → http://localhost:${PORT}  (runtime: $RUNTIME)"
  echo "To stop: ./stop.sh"
  echo ""
else
  if grep -qi "socket\|daemon\|connect" "$COMPOSE_ERR" 2>/dev/null; then
    echo ""
    echo "Error: $RUNTIME daemon is not running or the socket is not reachable."
    if [ "$RUNTIME" = "docker" ]; then
      echo "       Start Docker Desktop and try again."
    else
      echo "       Run: podman machine start"
    fi
  else
    cat "$COMPOSE_ERR"
    echo ""
    echo "Error: Failed to start containers."
  fi
  rm -f "$COMPOSE_ERR"
  echo ""
  exit 1
fi

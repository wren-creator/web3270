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
[ ! -f lpars.txt ] && echo '# id, name, host/IP, port, tls, type, model' > lpars.txt

# ── Migrate macros from old location if needed ────────────────────────────
mkdir -p macros/local
if [ -f macros/macros.json ] && [ ! -f macros/local/macros.json ]; then
  cp macros/macros.json macros/local/macros.json
  echo "Migrated macros to new location."
fi

# ── Start ──────────────────────────────────────────────────────────────────
PORT=$(grep '^BRIDGE_HOST_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT=${PORT:-8081}

$COMPOSE down
if $COMPOSE up -d --build; then
  echo ""
  echo "Bridge started → http://localhost:${PORT}  (runtime: $RUNTIME)"
  echo "To stop: ./stop.sh"
  echo ""
else
  echo ""
  echo "Error: Failed to start containers. Is Docker Desktop / Podman running?"
  echo ""
  exit 1
fi

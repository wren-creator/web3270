#!/bin/bash
# WebTerm/3270 Bridge — start
# First run: prompts to configure port, then starts.
# Subsequent runs: starts immediately using saved config.
# Reconfigure:  ./start.sh --setup

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

docker compose down
docker compose up -d --build

echo ""
echo "Bridge started → http://localhost:${PORT}"
echo "To stop: ./stop.sh"
echo ""

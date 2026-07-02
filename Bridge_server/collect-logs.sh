#!/bin/bash
# collect-logs.sh — collect and sanitize diagnostic logs for WebTerm/3270 Bridge
# Produces: webterm-diag-TIMESTAMP.zip  (safe to send — no real hosts, IPs, or userids)
# Usage: ./collect-logs.sh

set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info() { echo -e "${CYAN}[diag]${RESET}  $*"; }
ok()   { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET}  $*"; }

# ── Detect container runtime (Docker or Podman) ───────────────────────────
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  RUNTIME=docker
elif command -v podman &>/dev/null; then
  RUNTIME=podman
else
  echo "Error: neither docker nor podman found." >&2; exit 1
fi

if $RUNTIME compose version &>/dev/null 2>&1; then
  COMPOSE="$RUNTIME compose"
elif command -v podman-compose &>/dev/null; then
  COMPOSE="podman-compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  COMPOSE=""
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
WORKDIR="webterm-diag-${TIMESTAMP}"
ZIPFILE="webterm-diag-${TIMESTAMP}.zip"

echo ""
echo "WebTerm/3270 Bridge — Diagnostic Log Collector"
echo "================================================"
echo ""

mkdir -p "$WORKDIR"

# ── 1. System info ────────────────────────────────────────────────────────
info "Collecting system info…  (runtime: $RUNTIME)"
{
  echo "Collected: $(date)"
  echo "OS:        $(uname -a)"
  echo "Runtime:   $($RUNTIME --version 2>/dev/null || echo 'not found')"
  echo "Compose:   $(${COMPOSE:-echo} version 2>/dev/null || echo 'not found')"
  echo ""
  echo "=== compose ps ==="
  ${COMPOSE:-echo "(no compose tool)"} ps 2>/dev/null || echo "(compose not running)"
  echo ""
  echo "=== images ==="
  $RUNTIME images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" 2>/dev/null | grep -E 'REPO|bridge|mock' || true
} > "$WORKDIR/system-info.txt"
ok "system-info.txt"

# ── 2. Collect container logs ─────────────────────────────────────────────
info "Collecting container logs…"
for CONTAINER in tn3270-bridge mock-lpar mock-zvm mock-tpf; do
  if $RUNTIME inspect "$CONTAINER" &>/dev/null; then
    $RUNTIME logs "$CONTAINER" --timestamps 2>&1 > "$WORKDIR/${CONTAINER}.log" || true
    ok "${CONTAINER}.log"
  else
    warn "$CONTAINER not running — skipping"
  fi
done

# ── 3. Build redaction map from lpars files ───────────────────────────────
info "Building redaction map from lpars files…"
declare -a HOSTS=()
REDACTION_MAP="$WORKDIR/redaction-map.txt"

echo "Redaction map — generated $(date)" > "$REDACTION_MAP"
echo "Use this to interpret [HOST-N] and [IP-N] placeholders in logs." >> "$REDACTION_MAP"
echo "" >> "$REDACTION_MAP"
echo "NOTE: This file contains your real hostnames. Do NOT send this file." >> "$REDACTION_MAP"
echo "Keep it locally to cross-reference the sanitized logs." >> "$REDACTION_MAP"
echo "" >> "$REDACTION_MAP"

HOST_IDX=1
for LPAR_FILE in lpars.txt lpars.shipped.txt; do
  [ -f "$LPAR_FILE" ] || continue
  while IFS= read -r LINE; do
    # Skip comments and blank lines
    [[ "$LINE" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${LINE// }" ]] && continue
    # Extract host field (column 3, 0-indexed col 2)
    HOST=$(echo "$LINE" | cut -d',' -f3 | tr -d '[:space:]')
    [ -z "$HOST" ] && continue
    # Skip mock hosts — they're not sensitive
    [[ "$HOST" == mock-* ]] && continue
    [[ "$HOST" == "mock-lpar" || "$HOST" == "mock-zvm" || "$HOST" == "mock-tpf" ]] && continue
    HOSTS+=("$HOST")
    echo "  [HOST-${HOST_IDX}] = ${HOST}  (from ${LPAR_FILE})" >> "$REDACTION_MAP"
    HOST_IDX=$((HOST_IDX + 1))
  done < "$LPAR_FILE"
done
ok "redaction-map.txt (keep this locally — do not send)"

# ── 4. Sanitize all log files ─────────────────────────────────────────────
info "Sanitizing logs…"

sanitize_file() {
  local FILE="$1"
  local TMP="${FILE}.tmp"

  cp "$FILE" "$TMP"

  # Replace known hosts with [HOST-N]
  local IDX=1
  for HOST in "${HOSTS[@]}"; do
    if [ -n "$HOST" ]; then
      sed -i.bak "s|${HOST}|[HOST-${IDX}]|g" "$TMP" 2>/dev/null || \
      sed -i '' "s|${HOST}|[HOST-${IDX}]|g" "$TMP"  # macOS fallback
      IDX=$((IDX + 1))
    fi
  done

  # Redact IPv4 addresses
  sed -i.bak -E 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/[REDACTED-IP]/g' "$TMP" 2>/dev/null || \
  sed -i '' -E 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/[REDACTED-IP]/g' "$TMP"

  # Redact IPv6 addresses (basic pattern)
  sed -i.bak -E 's/([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}/[REDACTED-IPV6]/g' "$TMP" 2>/dev/null || \
  sed -i '' -E 's/([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}/[REDACTED-IPV6]/g' "$TMP"

  # Redact field data values (macro steps — may contain userid/password)
  sed -i.bak -E 's/"data":[[:space:]]*"[^"]*"/"data": "[REDACTED]"/g' "$TMP" 2>/dev/null || \
  sed -i '' -E 's/"data":[[:space:]]*"[^"]*"/"data": "[REDACTED]"/g' "$TMP"

  # Redact tokens after userid/user:/logon keywords (case-insensitive)
  sed -i.bak -E 's/(userid|user:|logon)[[:space:]]+[^[:space:],\}"]+/\1 [REDACTED-USER]/gI' "$TMP" 2>/dev/null || \
  sed -i '' -E 's/(userid|user:|logon)[[:space:]]+[^[:space:],\}"]+/\1 [REDACTED-USER]/gI' "$TMP"

  # Clean up sed backup files
  rm -f "${TMP}.bak"
  mv "$TMP" "$FILE"
}

for LOGFILE in "$WORKDIR"/*.log "$WORKDIR/system-info.txt"; do
  [ -f "$LOGFILE" ] || continue
  sanitize_file "$LOGFILE"
  ok "Sanitized: $(basename "$LOGFILE")"
done

# ── 5. Include sanitized lpars structure ──────────────────────────────────
info "Including sanitized lpars structure…"
{
  echo "# lpars structure (hosts and IPs replaced — see redaction-map.txt)"
  echo "# Columns: id, name, host, port, tls, type, model, tn3270e"
  echo ""
  for LPAR_FILE in lpars.txt lpars.shipped.txt; do
    [ -f "$LPAR_FILE" ] || continue
    echo "# === $LPAR_FILE ==="
    IDX=1
    while IFS= read -r LINE; do
      [[ "$LINE" =~ ^[[:space:]]*# ]] && { echo "$LINE"; continue; }
      [[ -z "${LINE// }" ]] && { echo ""; continue; }
      HOST=$(echo "$LINE" | cut -d',' -f3 | tr -d '[:space:]')
      if [[ "$HOST" == mock-* ]] || [[ "$HOST" == "mock-lpar" || "$HOST" == "mock-zvm" || "$HOST" == "mock-tpf" ]]; then
        echo "$LINE"
      else
        echo "$LINE" | sed "s|${HOST}|[HOST-${IDX}]|g"
        IDX=$((IDX + 1))
      fi
    done < "$LPAR_FILE"
    echo ""
  done
} > "$WORKDIR/lpars-sanitized.txt"
ok "lpars-sanitized.txt"

# ── 6. Remove redaction map from zip payload ──────────────────────────────
# The map stays local — move it out of WORKDIR before zipping
mv "$WORKDIR/redaction-map.txt" "./redaction-map-${TIMESTAMP}.txt"

# ── 7. Package as zip ─────────────────────────────────────────────────────
info "Creating zip…"
if command -v zip &>/dev/null; then
  zip -r "$ZIPFILE" "$WORKDIR" -x "*.bak" > /dev/null
else
  warn "zip not found — falling back to tar.gz"
  ZIPFILE="${WORKDIR}.tar.gz"
  tar -czf "$ZIPFILE" "$WORKDIR"
fi

rm -rf "$WORKDIR"
ok "Created: $ZIPFILE"

# ── 8. Done ───────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo ""
echo "  Diagnostic package: ${ZIPFILE}"
echo "  Redaction map:      redaction-map-${TIMESTAMP}.txt  ← keep this locally"
echo ""
echo "  Before sending, you can inspect the zip contents to confirm"
echo "  no real hostnames, IPs, or userids remain."
echo ""
echo "  Send ${ZIPFILE} to Britley via:"
echo "    Slack DM  → https://britleydev.slack.com  (@britley)"
echo "    Email     → britleyhoff@gmail.com"
echo ""

#!/usr/bin/env bash
# Loops through lpars.txt, connects to each TLS-enabled entry, pulls the
# cert's Subject Alternative Names, and prints a ready-to-paste line with
# the tlsServername column (col 10) filled in. See config.js / lpars.txt
# for what that column does — fixes "Hostname/IP does not match
# certificate's altnames" when host/IP is dialed by IP but the cert was
# issued to a DNS name.
#
# Usage: scripts/lpars-tls-servernames.sh [path-to-lpars-file]
# Defaults to lpars.txt in the repo root. Only touches entries with the
# tls column set to true — plaintext entries don't need a servername.

set -uo pipefail

LPARS_FILE="${1:-lpars.txt}"

if [[ ! -f "$LPARS_FILE" ]]; then
  echo "No such file: $LPARS_FILE" >&2
  exit 1
fi

TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout 5"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout 5"
fi

while IFS= read -r line; do
  trimmed="$(echo "$line" | sed 's/^[[:space:]]*//')"
  [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue

  IFS=',' read -r id name host port tls type model tn3270e protocol tlsServername <<< "$line"
  id=$(echo "$id" | xargs); host=$(echo "$host" | xargs); port=$(echo "$port" | xargs)
  tls=$(echo "${tls:-}" | xargs); type=$(echo "${type:-}" | xargs); model=$(echo "${model:-}" | xargs)
  tn3270e=$(echo "${tn3270e:-}" | xargs); protocol=$(echo "${protocol:-}" | xargs)

  [[ "$tls" != "true" ]] && continue

  echo "--- $id ($host:$port) ---"

  cert_text=$($TIMEOUT_CMD openssl s_client -connect "${host}:${port}" -showcerts </dev/null 2>/dev/null \
    | openssl x509 -noout -text 2>/dev/null)

  if [[ -z "$cert_text" ]]; then
    echo "  could not fetch cert (unreachable, wrong port, or not TLS) — skipped"
    echo
    continue
  fi

  sans=$(echo "$cert_text" | grep -A1 "Subject Alternative Name" | tail -1 \
    | tr ',' '\n' | sed -n 's/.*DNS:\([^ ]*\).*/\1/p')

  if [[ -z "$sans" ]]; then
    echo "  cert has no DNS SANs — check it manually (may be IP-only or CN-only)"
    echo
    continue
  fi

  first_san=$(echo "$sans" | head -1)
  echo "  SAN candidates: $(echo "$sans" | tr '\n' ' ')"
  echo "  suggested line:"
  echo "  ${id}, ${name}, ${host}, ${port}, ${tls}, ${type}, ${model}, ${tn3270e:-true}, ${protocol:-3270}, ${first_san}"
  echo
done < "$LPARS_FILE"

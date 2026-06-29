#!/bin/sh
# Runs as root. Seeds macros/local/macros.json if absent, then fixes all
# ownership so tn3270 can always read and write regardless of how Docker
# created the bind-mount directory.
mkdir -p /app/macros/local
[ -f /app/macros/local/macros.json ] || echo '[]' > /app/macros/local/macros.json
chown -R tn3270:tn3270 /app/macros/local
exec su-exec tn3270 "$@"

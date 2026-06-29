#!/bin/sh
# Runs as root. Ensures macros/local is owned by tn3270 regardless of how
# Docker created it (Docker creates bind-mount dirs as root when missing).
mkdir -p /app/macros/local
chown tn3270:tn3270 /app/macros/local
exec su-exec tn3270 "$@"

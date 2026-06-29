#!/bin/sh
# Runs as root. Ensures macros/local and its contents are owned by tn3270
# regardless of how Docker created the directory or who wrote existing files.
mkdir -p /app/macros/local
chown -R tn3270:tn3270 /app/macros/local
exec su-exec tn3270 "$@"

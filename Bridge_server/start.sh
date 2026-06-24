#!/bin/bash
[ ! -f lpars.txt ]   && echo '# id, name, host/IP, port, tls, type, model' > lpars.txt
[ ! -f macros.json ] && echo '[]' > macros.json
docker compose down
docker compose up -d --build

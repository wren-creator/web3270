if (-not (Test-Path "lpars.txt")) {
	    "# id, name, host/IP, port, tls, type, model" | Out-File -Encoding utf8 lpars.txt
}
docker compose down
docker compose up -d

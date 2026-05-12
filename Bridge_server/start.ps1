if (-not (Test-Path "lpars.txt")) {
	    "# id, name, host/IP, port, tls, type, model" | Out-File -Encoding utf8 lpars.txt
}
if not exist macros.json (
  echo []> macros.json
)
docker compose down
docker compose up -d

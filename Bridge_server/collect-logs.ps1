# collect-logs.ps1 — collect and sanitize diagnostic logs for WebTerm/3270 Bridge
# Produces: webterm-diag-TIMESTAMP.zip  (safe to send — no real hosts, IPs, or userids)
# Usage: .\collect-logs.ps1
#
# Run from the Bridge_server directory.

$ErrorActionPreference = "Stop"

function Info  { param($msg) Write-Host "[diag]  $msg" -ForegroundColor Cyan   }
function Ok    { param($msg) Write-Host "[ok]    $msg" -ForegroundColor Green  }
function Warn  { param($msg) Write-Host "[warn]  $msg" -ForegroundColor Yellow }

# ── Detect container runtime (Docker or Podman) ───────────────────────────
$Runtime = $null
$Compose = $null

if (Get-Command docker -ErrorAction SilentlyContinue) {
  $Runtime = "docker"
} elseif (Get-Command podman -ErrorAction SilentlyContinue) {
  $Runtime = "podman"
}
if (-not $Runtime) {
  Write-Error "Neither docker nor podman found. Install Docker Desktop or Podman."; exit 1
}

try { & $Runtime compose version 2>&1 | Out-Null; $Compose = "$Runtime compose" } catch {}
if (-not $Compose -and (Get-Command podman-compose -ErrorAction SilentlyContinue)) { $Compose = "podman-compose" }
if (-not $Compose -and (Get-Command docker-compose -ErrorAction SilentlyContinue)) { $Compose = "docker-compose" }

$Timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$WorkDir    = "webterm-diag-$Timestamp"
$ZipFile    = "webterm-diag-$Timestamp.zip"
$MapFile    = "redaction-map-$Timestamp.txt"

Write-Host ""
Write-Host "WebTerm/3270 Bridge -- Diagnostic Log Collector" -ForegroundColor Cyan
Write-Host "================================================"
Write-Host ""

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

# ── 1. System info ────────────────────────────────────────────────────────
Info "Collecting system info..."
Info "Collecting system info...  (runtime: $Runtime)"
$SysInfo = @()
$SysInfo += "Collected: $(Get-Date)"
$SysInfo += "OS:        $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
$SysInfo += "Runtime:   $Runtime"
try   { $SysInfo += "Version:   $(& $Runtime --version 2>&1)" }  catch { $SysInfo += "Version:   not found" }
if ($Compose) {
  try { $SysInfo += "Compose:   $(Invoke-Expression "$Compose version" 2>&1)" } catch { $SysInfo += "Compose:   not found" }
  $SysInfo += ""
  $SysInfo += "=== compose ps ==="
  try { $SysInfo += (Invoke-Expression "$Compose ps" 2>&1) } catch { $SysInfo += "(compose not running)" }
}
$SysInfo | Set-Content "$WorkDir\system-info.txt" -Encoding UTF8
Ok "system-info.txt"

# ── 2. Collect container logs ─────────────────────────────────────────────
Info "Collecting container logs..."
$Containers = @("tn3270-bridge", "mock-lpar", "mock-zvm", "mock-tpf")
foreach ($C in $Containers) {
  & $Runtime inspect $C 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    & $Runtime logs $C --timestamps 2>&1 | Set-Content "$WorkDir\$C.log" -Encoding UTF8
    Ok "$C.log"
  } else {
    Warn "$C not running -- skipping"
  }
}

# ── 3. Build redaction map from lpars files ───────────────────────────────
Info "Building redaction map from lpars files..."
$Hosts   = [System.Collections.ArrayList]@()
$MapLines = @()
$MapLines += "Redaction map -- generated $(Get-Date)"
$MapLines += "Use this to interpret [HOST-N] and [IP-N] placeholders in logs."
$MapLines += ""
$MapLines += "NOTE: This file contains your real hostnames. Do NOT send this file."
$MapLines += "Keep it locally to cross-reference the sanitized logs."
$MapLines += ""

$HostIdx = 1
foreach ($LparFile in @("lpars.txt", "lpars.shipped.txt")) {
  if (-not (Test-Path $LparFile)) { continue }
  foreach ($Line in Get-Content $LparFile -Encoding UTF8) {
    $Trimmed = $Line.Trim()
    if ($Trimmed -eq "" -or $Trimmed.StartsWith("#")) { continue }
    $Parts = $Trimmed -split ","
    if ($Parts.Count -lt 3) { continue }
    $Host = $Parts[2].Trim()
    if ($Host -eq "" -or $Host -match "^mock-") { continue }
    [void]$Hosts.Add($Host)
    $MapLines += "  [HOST-$HostIdx] = $Host  (from $LparFile)"
    $HostIdx++
  }
}
$MapLines | Set-Content $MapFile -Encoding UTF8
Ok "redaction-map-$Timestamp.txt (keep this locally -- do not send)"

# ── 4. Sanitize all collected files ───────────────────────────────────────
Info "Sanitizing logs..."

function Sanitize-File {
  param([string]$FilePath)

  $Content = Get-Content $FilePath -Raw -Encoding UTF8
  if (-not $Content) { return }

  # Replace known hosts with [HOST-N]
  $Idx = 1
  foreach ($H in $Hosts) {
    $Content = $Content -replace [regex]::Escape($H), "[HOST-$Idx]"
    $Idx++
  }

  # Redact IPv4 addresses
  $Content = $Content -replace '\b(\d{1,3}\.){3}\d{1,3}\b', '[REDACTED-IP]'

  # Redact IPv6 addresses (basic pattern)
  $Content = $Content -replace '([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}', '[REDACTED-IPV6]'

  # Redact field data values (macro steps — may contain userid/password)
  $Content = $Content -replace '"data":\s*"[^"]*"', '"data": "[REDACTED]"'

  # Redact tokens after userid / user: / logon keywords
  $Content = $Content -replace '(?i)(userid|user:|logon)\s+\S+', '$1 [REDACTED-USER]'

  $Content | Set-Content $FilePath -Encoding UTF8 -NoNewline
}

$LogFiles = Get-ChildItem "$WorkDir\*.log", "$WorkDir\system-info.txt" -ErrorAction SilentlyContinue
foreach ($F in $LogFiles) {
  Sanitize-File $F.FullName
  Ok "Sanitized: $($F.Name)"
}

# ── 5. Include sanitized lpars structure ──────────────────────────────────
Info "Including sanitized lpars structure..."
$LparOut = @()
$LparOut += "# lpars structure (hosts and IPs replaced -- see redaction-map.txt)"
$LparOut += "# Columns: id, name, host, port, tls, type, model, tn3270e"
$LparOut += ""

foreach ($LparFile in @("lpars.txt", "lpars.shipped.txt")) {
  if (-not (Test-Path $LparFile)) { continue }
  $LparOut += "# === $LparFile ==="
  $Idx = 1
  foreach ($Line in Get-Content $LparFile -Encoding UTF8) {
    $Trimmed = $Line.Trim()
    if ($Trimmed -eq "" -or $Trimmed.StartsWith("#")) { $LparOut += $Line; continue }
    $Parts = $Trimmed -split ","
    if ($Parts.Count -lt 3) { $LparOut += $Line; continue }
    $Host = $Parts[2].Trim()
    if ($Host -match "^mock-") { $LparOut += $Line }
    else {
      $LparOut += $Line -replace [regex]::Escape($Host), "[HOST-$Idx]"
      $Idx++
    }
  }
  $LparOut += ""
}
$LparOut | Set-Content "$WorkDir\lpars-sanitized.txt" -Encoding UTF8
Ok "lpars-sanitized.txt"

# ── 6. Package as zip ─────────────────────────────────────────────────────
Info "Creating zip..."
if (Test-Path $ZipFile) { Remove-Item $ZipFile -Force }
Compress-Archive -Path $WorkDir -DestinationPath $ZipFile -CompressionLevel Optimal
Remove-Item -Recurse -Force $WorkDir
Ok "Created: $ZipFile"

# ── 7. Done ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================"
Write-Host ""
Write-Host "  Diagnostic package: $ZipFile"
Write-Host "  Redaction map:      $MapFile  <- keep this locally"
Write-Host ""
Write-Host "  Before sending, you can open the zip to confirm"
Write-Host "  no real hostnames, IPs, or userids remain."
Write-Host ""
Write-Host "  Send $ZipFile to Britley via:"
Write-Host "    Slack DM  -> https://britleydev.slack.com  (@britley)"
Write-Host "    Email     -> britleyhoff@gmail.com"
Write-Host ""

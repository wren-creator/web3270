#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WebTerm/3270 — Windows Installer Part 2
    Installs Node.js in Ubuntu, copies project files into WSL2,
    runs npm install, configures .env, and optionally sets up auto-start.

.NOTES
    Run this AFTER rebooting from install-part1.ps1
    and completing Ubuntu's first-launch username/password setup.
    Must be run as Administrator.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ───────────────────────────────────────────────────────
function Write-Header {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       WebTerm/3270  —  Installer  Part 2         ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "  ► $Message" -ForegroundColor Cyan
}

function Write-OK {
    param([string]$Message)
    Write-Host "  ✔ $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  ⚠ $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  ✖ $Message" -ForegroundColor Red
}

function Pause-AndExit {
    param([string]$Message)
    Write-Host ""
    Write-Fail $Message
    Write-Host ""
    Write-Host "  Press any key to exit..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

function Run-InWSL {
    param([string]$BashCommand)
    $output = wsl -d Ubuntu -- bash -c $BashCommand 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "WSL command failed (exit $LASTEXITCODE): $BashCommand`nOutput: $output"
    }
    return $output
}

# ── Header ────────────────────────────────────────────────────────
Write-Header

# ── Step 1 · Verify WSL + Ubuntu are available ────────────────────
Write-Step "Verifying WSL2 and Ubuntu..."

try {
    $wslList = wsl --list --verbose 2>&1
    if ($LASTEXITCODE -ne 0) {
        Pause-AndExit "WSL does not appear to be installed. Please run install-part1.ps1 first."
    }
} catch {
    Pause-AndExit "Could not run 'wsl' command. Please run install-part1.ps1 first."
}

if ($wslList -notmatch 'Ubuntu') {
    Pause-AndExit "Ubuntu is not listed in WSL. Please run install-part1.ps1 first and complete Ubuntu first-launch setup."
}

Write-OK "WSL2 + Ubuntu found"

# ── Step 2 · Check Ubuntu first-launch is complete ───────────────
Write-Step "Checking Ubuntu is fully initialised..."

try {
    $whoami = Run-InWSL "whoami"
    $whoami = $whoami.Trim()
    if ($whoami -eq 'root') {
        Write-Warn "Ubuntu is running as root — you may not have completed first-launch setup."
        Write-Host ""
        Write-Host "  If you haven't created a Linux username yet:" -ForegroundColor Yellow
        Write-Host "  1. Open the Ubuntu app from the Start menu" -ForegroundColor Yellow
        Write-Host "  2. Follow the prompts to create a username and password" -ForegroundColor Yellow
        Write-Host "  3. Close Ubuntu and re-run this script" -ForegroundColor Yellow
        Write-Host ""
        $cont = Read-Host "  Continue anyway? [y/N]"
        if ($cont -notmatch '^[Yy]') { exit 0 }
    } else {
        Write-OK "Ubuntu running as: $whoami"
    }
} catch {
    Pause-AndExit "Could not connect to Ubuntu. Make sure you completed the Ubuntu first-launch (username + password) setup before running this script."
}

# ── Step 3 · Locate project source files ─────────────────────────
Write-Step "Locating project source files..."

# Try to load saved state from Part 1
$statePath = Join-Path $env:TEMP "webterm3270_install_state.json"
$sourceDir = $null

if (Test-Path $statePath) {
    try {
        $state     = Get-Content $statePath -Raw | ConvertFrom-Json
        $sourceDir = $state.SourceDir
    } catch { }
}

# Fall back to the directory this script lives in
if (-not $sourceDir -or -not (Test-Path $sourceDir)) {
    $sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# Confirm the project files are here
$requiredFiles = @('server.js', 'config.js', 'package.json')
$missingFiles  = $requiredFiles | Where-Object { -not (Test-Path (Join-Path $sourceDir $_)) }

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Warn "Could not find project files in: $sourceDir"
    Write-Host "  Missing: $($missingFiles -join ', ')" -ForegroundColor Red
    Write-Host ""
    $sourceDir = Read-Host "  Enter the full path to the tn3270-bridge project folder"
    $sourceDir = $sourceDir.Trim('"').Trim("'")

    $missingFiles = $requiredFiles | Where-Object { -not (Test-Path (Join-Path $sourceDir $_)) }
    if ($missingFiles.Count -gt 0) {
        Pause-AndExit "Still can't find project files in: $sourceDir`nMissing: $($missingFiles -join ', ')"
    }
}

Write-OK "Project source found: $sourceDir"

# ── Step 4 · Convert Windows path → WSL path ─────────────────────
Write-Step "Mapping Windows path to WSL filesystem..."

# e.g.  C:\tools\tn3270-bridge  →  /mnt/c/tools/tn3270-bridge
$driveLetter  = $sourceDir.Substring(0,1).ToLower()
$pathRemainder = $sourceDir.Substring(2).Replace('\', '/')
$wslSourcePath = "/mnt/$driveLetter$pathRemainder"

Write-OK "WSL source path: $wslSourcePath"

# Destination inside WSL2
$wslDestPath = "~/tn3270-bridge"

# ── Step 5 · Update Ubuntu packages ───────────────────────────────
Write-Step "Updating Ubuntu package lists (this may take a minute)..."

try {
    Run-InWSL "sudo apt-get update -qq" | Out-Null
    Write-OK "Package lists updated"
} catch {
    Write-Warn "apt update had warnings — continuing anyway"
}

# ── Step 6 · Install Node.js 20 via NodeSource ───────────────────
Write-Step "Checking for Node.js..."

$nodeCheck = wsl -d Ubuntu -- bash -c "node --version 2>/dev/null" 2>&1
$nodeOk    = ($LASTEXITCODE -eq 0) -and ($nodeCheck -match 'v[12]\d\.')

if ($nodeOk) {
    Write-OK "Node.js already installed: $($nodeCheck.Trim())"
} else {
    Write-Step "Installing Node.js 20 LTS via NodeSource..."
    Write-Warn "This will take 1–3 minutes on first run."

    try {
        Run-InWSL "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1" | Out-Null
        Run-InWSL "sudo apt-get install -y nodejs 2>&1" | Out-Null

        $nodeVer = Run-InWSL "node --version"
        Write-OK "Node.js installed: $($nodeVer.Trim())"
    } catch {
        Pause-AndExit "Failed to install Node.js in Ubuntu.`nError: $_`n`nTry opening Ubuntu manually and running:`n  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`n  sudo apt-get install -y nodejs"
    }
}

# ── Step 7 · Copy project files into WSL2 ────────────────────────
Write-Step "Copying project files into WSL2..."

try {
    # Remove old copy if it exists so we get a clean install
    Run-InWSL "rm -rf $wslDestPath" | Out-Null
    Run-InWSL "cp -r '$wslSourcePath' $wslDestPath" | Out-Null
    Write-OK "Files copied to $wslDestPath"
} catch {
    Pause-AndExit "Failed to copy project files into WSL2.`nError: $_`n`nMake sure the project folder is accessible from WSL2 (it must be on a local drive, not a network drive)."
}

# ── Step 8 · npm install ─────────────────────────────────────────
Write-Step "Installing npm dependencies (ws package)..."

try {
    Run-InWSL "cd $wslDestPath && npm install --omit=dev 2>&1" | Out-Null
    Write-OK "npm install complete"
} catch {
    Pause-AndExit "npm install failed.`nError: $_"
}

# ── Step 9 · Configure .env ───────────────────────────────────────
Write-Step "Configuring environment file..."

# Check if .env already exists in the WSL destination
$envExists = wsl -d Ubuntu -- bash -c "test -f $wslDestPath/.env && echo yes || echo no" 2>&1

if ($envExists.Trim() -eq 'yes') {
    Write-OK ".env already exists — skipping (edit manually if needed)"
} else {
    # Copy from .env.example
    $exampleExists = wsl -d Ubuntu -- bash -c "test -f $wslDestPath/.env.example && echo yes || echo no" 2>&1
    if ($exampleExists.Trim() -eq 'yes') {
        Run-InWSL "cp $wslDestPath/.env.example $wslDestPath/.env" | Out-Null
        Write-OK ".env created from .env.example"
    } else {
        Write-Warn ".env.example not found — creating a minimal .env"
        $minimalEnv = "BRIDGE_PORT=8081`nLOG_LEVEL=info`nBRIDGE_VERIFY_TLS=false`n"
        Run-InWSL "printf '$minimalEnv' > $wslDestPath/.env" | Out-Null
    }

    # Optionally prompt for LPAR details and write to lpars.txt
    Write-Host ""
    Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  Optional: configure your first LPAR now." -ForegroundColor White
    Write-Host "  You can also edit lpars.txt inside WSL2 later." -ForegroundColor DarkGray
    Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""

    $configureLpar = Read-Host "  Configure an LPAR now? [y/N]"
    if ($configureLpar -match '^[Yy]') {

        $lparId   = Read-Host "  LPAR ID (short, no spaces, e.g. prod01)"
        $lparName = Read-Host "  LPAR display name (e.g. PROD01)"
        $lparHost = Read-Host "  LPAR host or IP (e.g. 10.80.1.1)"
        $lparPort = Read-Host "  Port [339]"
        $lparTls  = Read-Host "  Use TLS? [y/N]"
        $lparType = Read-Host "  Type (TSO/VM) [TSO]"

        if ([string]::IsNullOrWhiteSpace($lparPort)) { $lparPort = "339" }
        if ([string]::IsNullOrWhiteSpace($lparType)) { $lparType = "TSO" }
        $tlsValue = if ($lparTls -match '^[Yy]') { "true" } else { "false" }

        $lparLine = "$lparId, $lparName, $lparHost, $lparPort, $tlsValue, $lparType"

        # Write lpars.txt
        $lparsContent = "# id, name, host/IP, port, tls, type`n$lparLine`n"
        Run-InWSL "printf '$lparsContent' > $wslDestPath/lpars.txt" | Out-Null
        Write-OK "lpars.txt written with entry: $lparLine"
    } else {
        Write-Warn "Skipped — edit $wslDestPath/lpars.txt in WSL2 to add your LPARs"
    }
}

# ── Step 10 · Quick smoke test ────────────────────────────────────
Write-Step "Running quick smoke test..."

try {
    $testResult = Run-InWSL "cd $wslDestPath && node -e 'const c = require(`"./config`"); console.log(`"OK profiles:`" + c.profiles.length)' 2>&1"
    Write-OK "Config loads cleanly: $($testResult.Trim())"
} catch {
    Write-Warn "Smoke test had warnings — the bridge may still work. Check manually."
}

# ── Step 11 · Optional auto-start via Task Scheduler ─────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Optional: auto-start the bridge on Windows login." -ForegroundColor White
Write-Host "  This creates a Task Scheduler entry that runs" -ForegroundColor DarkGray
Write-Host "  'node server.js' inside WSL2 at logon." -ForegroundColor DarkGray
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

$autoStart = Read-Host "  Set up auto-start on login? [y/N]"
if ($autoStart -match '^[Yy]') {
    Write-Step "Registering Task Scheduler entry..."

    try {
        $taskName = "WebTerm3270 Bridge"

        # Remove existing task if present
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

        $action = New-ScheduledTaskAction `
            -Execute "wsl.exe" `
            -Argument "-d Ubuntu -- bash -c 'cd ~/tn3270-bridge && node server.js >> ~/tn3270-bridge/bridge.log 2>&1'"

        $trigger = New-ScheduledTaskTrigger -AtLogOn

        $settings = New-ScheduledTaskSettingsSet `
            -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -StartWhenAvailable $true

        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -RunLevel Highest `
            -Force | Out-Null

        Write-OK "Task '$taskName' registered — bridge will start at next login"
        Write-Host "  To remove:  Unregister-ScheduledTask -TaskName '$taskName'" -ForegroundColor DarkGray
    } catch {
        Write-Warn "Could not create scheduled task: $_"
        Write-Warn "You can start the bridge manually with:"
        Write-Host "  wsl -d Ubuntu -- bash -c 'cd ~/tn3270-bridge && node server.js'" -ForegroundColor DarkGray
    }
} else {
    Write-Warn "Auto-start skipped. To start the bridge manually:"
    Write-Host "  wsl -d Ubuntu -- bash -c 'cd ~/tn3270-bridge && node server.js'" -ForegroundColor DarkGray
}

# ── Done ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  ✔  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  To start the bridge now, open PowerShell and run:" -ForegroundColor White
Write-Host "    wsl -d Ubuntu -- bash -c 'cd ~/tn3270-bridge && node server.js'" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Then open your browser to:" -ForegroundColor White
Write-Host "    http://localhost:8081" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To view the bridge log:" -ForegroundColor White
Write-Host "    wsl cat ~/tn3270-bridge/bridge.log" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To edit LPAR profiles later:" -ForegroundColor White
Write-Host "    wsl -d Ubuntu -- bash -c 'nano ~/tn3270-bridge/lpars.txt'" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# Clean up state file
if (Test-Path $statePath) {
    Remove-Item $statePath -Force -ErrorAction SilentlyContinue
}

Write-Host "  Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

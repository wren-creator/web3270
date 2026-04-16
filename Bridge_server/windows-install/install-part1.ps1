#Requires -RunAsAdministrator
<#
.SYNOPSIS
    WebTerm/3270 — Windows Installer Part 1
    Enables WSL2, installs Ubuntu, then prompts for reboot.
    Run install-part2.ps1 after rebooting to complete the setup.

.NOTES
    Must be run as Administrator.
    Tested on Windows 10 (2004+) and Windows 11.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ───────────────────────────────────────────────────────
function Write-Header {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       WebTerm/3270  —  Installer  Part 1         ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
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
    Write-Fail $Message
    Write-Host ""
    Write-Host "  Press any key to exit..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# ── Header ────────────────────────────────────────────────────────
Write-Header

# ── Step 1 · Check Windows version ────────────────────────────────
Write-Step "Checking Windows version..."

$winVer = [System.Environment]::OSVersion.Version
$build  = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").CurrentBuild

if ($winVer.Major -lt 10) {
    Pause-AndExit "Windows 10 version 2004 (build 19041) or later is required. Found: $($winVer.ToString())"
}

if ([int]$build -lt 19041) {
    Pause-AndExit "Windows build 19041 or later is required for WSL2. Found build: $build`n  Please run Windows Update and try again."
}

Write-OK "Windows build $build — OK"

# ── Step 2 · Check if WSL is already installed ────────────────────
Write-Step "Checking for existing WSL installation..."

$wslInstalled   = $false
$ubuntuInstalled = $false

try {
    $wslOutput = wsl --list --verbose 2>&1
    if ($LASTEXITCODE -eq 0) {
        $wslInstalled = $true
        Write-OK "WSL is already installed"

        # Check if Ubuntu is in the list
        if ($wslOutput -match 'Ubuntu') {
            $ubuntuInstalled = $true
            Write-OK "Ubuntu is already installed"
        }
    }
} catch {
    # wsl command not found — not installed yet
}

# ── Step 3 · Enable WSL features if needed ────────────────────────
if (-not $wslInstalled) {
    Write-Step "Enabling Windows Subsystem for Linux feature..."
    try {
        $result = Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart -WarningAction SilentlyContinue
        Write-OK "WSL feature enabled"
    } catch {
        Pause-AndExit "Failed to enable WSL feature: $_"
    }

    Write-Step "Enabling Virtual Machine Platform feature..."
    try {
        $result = Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart -WarningAction SilentlyContinue
        Write-OK "Virtual Machine Platform enabled"
    } catch {
        Pause-AndExit "Failed to enable Virtual Machine Platform: $_"
    }
} else {
    Write-OK "WSL features already enabled — skipping"
}

# ── Step 4 · Set WSL2 as default ──────────────────────────────────
Write-Step "Setting WSL2 as default version..."
try {
    wsl --set-default-version 2 2>&1 | Out-Null
    Write-OK "WSL2 set as default"
} catch {
    Write-Warn "Could not set WSL2 as default — this may be fine if WSL2 is already the default"
}

# ── Step 5 · Install Ubuntu if not present ───────────────────────
if (-not $ubuntuInstalled) {
    Write-Step "Installing Ubuntu (this may take a few minutes)..."
    Write-Host ""
    Write-Warn "If the Microsoft Store opens, click 'Get' or 'Install' to install Ubuntu."
    Write-Warn "Return to this window once it completes."
    Write-Host ""

    try {
        # Try wsl --install first (Windows 11 / newer Windows 10)
        wsl --install -d Ubuntu 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Ubuntu installation initiated"
        } else {
            throw "wsl --install returned $LASTEXITCODE"
        }
    } catch {
        # Fallback: winget
        Write-Warn "Trying winget as fallback installer..."
        try {
            winget install --id Canonical.Ubuntu --accept-source-agreements --accept-package-agreements
            Write-OK "Ubuntu installed via winget"
        } catch {
            Pause-AndExit "Could not install Ubuntu automatically.`n  Please install 'Ubuntu' from the Microsoft Store manually, then re-run this script."
        }
    }
} else {
    Write-OK "Ubuntu already installed — skipping"
}

# ── Step 6 · Save state for Part 2 ───────────────────────────────
Write-Step "Saving installer state for Part 2..."

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath  = Join-Path $env:TEMP "webterm3270_install_state.json"

$state = @{
    SourceDir  = $scriptDir
    InstalledAt = (Get-Date).ToString("o")
}

$state | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8
Write-OK "State saved to: $statePath"

# ── Step 7 · Done — prompt reboot ────────────────────────────────
Write-Host ""
Write-Host "  ════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Part 1 complete." -ForegroundColor Green
Write-Host ""
Write-Host "  A reboot is required to finish enabling WSL2." -ForegroundColor Yellow
Write-Host ""
Write-Host "  After rebooting:" -ForegroundColor White
Write-Host "    1. Ubuntu will open automatically — create your Linux" -ForegroundColor White
Write-Host "       username and password when prompted." -ForegroundColor White
Write-Host "    2. Once Ubuntu setup is done, CLOSE the Ubuntu window." -ForegroundColor White
Write-Host "    3. Run  install-part2.ps1  (as Administrator) to finish." -ForegroundColor White
Write-Host ""
Write-Host "  ════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$reboot = Read-Host "  Reboot now? [Y/n]"
if ($reboot -eq '' -or $reboot -match '^[Yy]') {
    Write-Host ""
    Write-Host "  Rebooting in 5 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    Restart-Computer -Force
} else {
    Write-Host ""
    Write-Warn "Reboot skipped. Remember to reboot before running install-part2.ps1"
    Write-Host ""
}

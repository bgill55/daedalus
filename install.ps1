$ErrorActionPreference = 'Stop'

function Write-Banner {
  Write-Host @"
╔═══════════════════════════════════════════════════════════════════╗
║  ██████╗  █████╗ ███████╗██████╗  █████╗ ██╗     ██╗   ██╗███████╗║
║  ██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██║     ██║   ██║██╔════╝║
║  ██║  ██║███████║█████╗  ██║  ██║███████║██║     ██║   ██║███████╗║
║  ██║  ██║██╔══██║██╔══╝  ██║  ██║██╔══██║██║     ██║   ██║╚════██║║
║  ██████╔╝██║  ██║███████╗██████╔╝██║  ██║███████╗╚██████╔╝███████║║
║  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝║
║                                                                   ║
║  o  local-first · embedded router · multi-agent · not sentient o  ║
╚═══════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
}

Write-Banner
Write-Host "[daedalus] Detected platform: Windows ($([Environment]::OSVersion.VersionString))" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[ERROR] Node.js (>= 20.0.0) is required to run Daedalus." -ForegroundColor Red
  Write-Host ""
  Write-Host "Install Node.js 20+ using one of the following:"
  Write-Host "  • winget:        winget install OpenJS.NodeJS.LTS"
  Write-Host "  • Chocolatey:    choco install nodejs-lts"
  Write-Host "  • Official site: https://nodejs.org/"
  exit 1
}

$nodeVerRaw = (node -v).Trim().TrimStart('v')
$nodeMajor = [int]($nodeVerRaw.Split('.')[0])

if ($nodeMajor -lt 20) {
  Write-Host "[ERROR] Found Node.js v$nodeVerRaw, but Daedalus requires Node.js >= 20.0.0." -ForegroundColor Red
  Write-Host "Please upgrade Node.js (e.g., 'winget upgrade OpenJS.NodeJS.LTS') and re-run this installer."
  exit 1
}

Write-Host "[OK] Node.js v$nodeVerRaw verified." -ForegroundColor Green

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "[ERROR] npm is required but was not found in PATH." -ForegroundColor Red
  exit 1
}

$packageSpec = if ($env:DAEDALUS_VERSION) { $env:DAEDALUS_VERSION } else { "daedalus-cli@latest" }
Write-Host "[daedalus] Installing $packageSpec via npm..." -ForegroundColor Cyan

npm install -g $packageSpec
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] npm install failed with exit code $LASTEXITCODE." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "[OK] Successfully installed $packageSpec." -ForegroundColor Green

if (Get-Command daedalus -ErrorAction SilentlyContinue) {
  $installedVer = try { (daedalus --version 2>$null) } catch { "latest" }
  Write-Host "[OK] Daedalus CLI ($installedVer) is ready in PATH!" -ForegroundColor Green
} else {
  $npmPrefix = (npm prefix -g).Trim()
  Write-Host "[WARN] 'daedalus' binary was installed to $npmPrefix, which may require restarting your terminal." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Quick Start:" -ForegroundColor White
Write-Host "  daedalus                 Launch interactive REPL" -ForegroundColor Cyan
Write-Host "  daedalus --tui           Launch interactive Terminal Dashboard (TUI)" -ForegroundColor Cyan
Write-Host "  daedalus --goal ""...""    Execute a one-shot autonomous goal" -ForegroundColor Cyan
Write-Host ""

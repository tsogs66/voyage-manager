#Requires -Version 5.1
# Update the local Voyage Report PC install from GitHub (still runs locally afterward).

$ErrorActionPreference = "Stop"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch { }

if (-not $NoonReportRepo) { $NoonReportRepo = "tsogs66/voyage-manager" }
if (-not $NoonReportBranch) { $NoonReportBranch = "main" }

$installer = Join-Path $PSScriptRoot "install-pc.ps1"
if (-not (Test-Path -LiteralPath $installer)) {
  $url = "https://raw.githubusercontent.com/$NoonReportRepo/$NoonReportBranch/install/pc/install-pc.ps1"
  $installer = Join-Path $env:TEMP "noonreport-install-pc.ps1"
  Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
}

Write-Host "Updating local Voyage Report from $NoonReportRepo @ $NoonReportBranch (local install only)..." -ForegroundColor Yellow
$NoonReportNoStart = $true
& $installer
Write-Host "Update done. Your voyage data in the browser is unchanged." -ForegroundColor Green
Write-Host "Start again with the Desktop shortcut or Start-NoonReport.bat"

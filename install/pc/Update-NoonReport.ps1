#Requires -Version 5.1
<#
.SYNOPSIS
  Update the local Noon Report PC install from GitHub (still runs locally afterward).
#>
param(
  [string]$Repo = "tsogs66/voyage-manager",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$installer = Join-Path $PSScriptRoot "install-pc.ps1"
if (-not (Test-Path $installer)) {
  # When run from bin\, fetch installer
  $url = "https://raw.githubusercontent.com/$Repo/$Branch/install/pc/install-pc.ps1"
  $installer = Join-Path $env:TEMP "noonreport-install-pc.ps1"
  Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
}

Write-Host "Updating local Noon Report from $Repo @ $Branch (local install only)..." -ForegroundColor Yellow
& $installer -Repo $Repo -Branch $Branch -NoStart
Write-Host "Update done. Your voyage data in the browser is unchanged." -ForegroundColor Green
Write-Host "Start again with the Desktop shortcut or Start-NoonReport.bat"

#Requires -Version 5.1
<#
.SYNOPSIS
  One-click PC install for Noon Report (runs fully local on this computer).
.DESCRIPTION
  Downloads the latest app from GitHub into %LOCALAPPDATA%\NoonReport\app,
  installs Start / Update launchers, creates a Desktop shortcut, and starts
  the local server. Every launch uses http://127.0.0.1 — not the online site.
  Voyage data stays in this browser's IndexedDB on the PC.

  One-click (PowerShell):
    irm https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/pc/install-pc.ps1 | iex
#>
param(
  [string]$Repo = "tsogs66/voyage-manager",
  [string]$Branch = "main",
  [switch]$NoStart,
  [switch]$PortableOnly
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$InstallRoot = Join-Path $env:LOCALAPPDATA "NoonReport"
$AppDir = Join-Path $InstallRoot "app"
$BinDir = Join-Path $InstallRoot "bin"
$ZipUrl = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
$RawBase = "https://raw.githubusercontent.com/$Repo/$Branch/install/pc"

Write-Host ""
Write-Host "  Noon Report — PC installer" -ForegroundColor Yellow
Write-Host "  Install folder: $InstallRoot"
Write-Host ""

New-Item -ItemType Directory -Force -Path $InstallRoot, $AppDir, $BinDir | Out-Null

$tmp = Join-Path $env:TEMP ("noonreport-pc-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp "repo.zip"

try {
  Write-Host "Downloading $ZipUrl ..."
  Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing

  Write-Host "Extracting..."
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $extracted = Get-ChildItem -Directory $tmp | Where-Object { $_.Name -like "voyage-manager-*" } | Select-Object -First 1
  if (-not $extracted) { throw "Could not find extracted repository folder." }

  $src = $extracted.FullName
  $copyList = @(
    "voyage_manager.html",
    "sw.js",
    "manifest.webmanifest",
    "icons"
  )
  foreach ($name in $copyList) {
    $from = Join-Path $src $name
    $to = Join-Path $AppDir $name
    if (-not (Test-Path $from)) { throw "Missing $name in download." }
    if (Test-Path $to) { Remove-Item -LiteralPath $to -Recurse -Force }
    Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
  }

  # Launchers into bin + app root for portable double-click use
  $launcherNames = @("Start-NoonReport.ps1", "Start-NoonReport.bat", "Update-NoonReport.ps1", "Update-NoonReport.bat")
  foreach ($ln in $launcherNames) {
    $fromPc = Join-Path $src "install\pc\$ln"
    if (Test-Path $fromPc) {
      Copy-Item -LiteralPath $fromPc -Destination (Join-Path $BinDir $ln) -Force
      Copy-Item -LiteralPath $fromPc -Destination (Join-Path $AppDir $ln) -Force
    } else {
      # Fallback: fetch from raw GitHub if zip layout changes
      try {
        Invoke-WebRequest -Uri "$RawBase/$ln" -OutFile (Join-Path $BinDir $ln) -UseBasicParsing
        Copy-Item (Join-Path $BinDir $ln) (Join-Path $AppDir $ln) -Force
      } catch {}
    }
  }

  # Version stamp
  @{
    installedAt = (Get-Date).ToString("o")
    repo = $Repo
    branch = $Branch
    source = $ZipUrl
    mode = "local-pc"
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot "install.json") -Encoding UTF8

  # Desktop shortcut
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Noon Report.lnk"
  $bat = Join-Path $BinDir "Start-NoonReport.bat"
  if (Test-Path $bat) {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($shortcutPath)
    $sc.TargetPath = $bat
    $sc.WorkingDirectory = $AppDir
    $sc.WindowStyle = 1
    $sc.Description = "Noon Report — local PC (offline-capable)"
    $icon = Join-Path $AppDir "icons\icon-192.png"
    if (Test-Path $icon) { $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,13" }
    $sc.Save()
    Write-Host "Desktop shortcut: $shortcutPath" -ForegroundColor Green
  }

  Write-Host ""
  Write-Host "Installed successfully." -ForegroundColor Green
  Write-Host "  App files : $AppDir"
  Write-Host "  Start     : double-click Desktop 'Noon Report' or run:"
  Write-Host "              $bat"
  Write-Host "  Update    : $BinDir\Update-NoonReport.bat"
  Write-Host ""
  Write-Host "This PC always runs locally (http://127.0.0.1). Online sync is optional under Data." -ForegroundColor DarkGray
  Write-Host ""

  if (-not $NoStart -and (Test-Path (Join-Path $BinDir "Start-NoonReport.ps1"))) {
    Write-Host "Starting Noon Report..."
    Start-Process powershell -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", (Join-Path $BinDir "Start-NoonReport.ps1"),
      "-AppDir", $AppDir
    )
  }
} finally {
  try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}

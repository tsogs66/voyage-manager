#Requires -Version 5.1
# Noon Report - one-click PC installer (local http://127.0.0.1, not the website).
#
# Recommended (Windows PowerShell):
#   $f="$env:TEMP\noon-install-pc.ps1"; iwr https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/pc/install-pc.ps1 -UseBasicParsing -OutFile $f; powershell -NoProfile -ExecutionPolicy Bypass -File $f
#
# Also works:
#   irm https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/pc/install-pc.ps1 | iex
#
# Optional overrides (set before irm|iex, or ignore when using -File):
#   $NoonReportRepo = "tsogs66/voyage-manager"
#   $NoonReportBranch = "main"
#   $NoonReportNoStart = $true

$ErrorActionPreference = "Stop"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch { }

# Defaults (no param{} block - irm|iex on Windows PS 5.1 breaks param)
if (-not $NoonReportRepo) { $NoonReportRepo = "tsogs66/voyage-manager" }
if (-not $NoonReportBranch) { $NoonReportBranch = "main" }
$NoStart = [bool]$NoonReportNoStart

$Repo = [string]$NoonReportRepo
$Branch = [string]$NoonReportBranch

$InstallRoot = Join-Path $env:LOCALAPPDATA "NoonReport"
$AppDir = Join-Path $InstallRoot "app"
$BinDir = Join-Path $InstallRoot "bin"
$ZipUrl = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
$RawBase = "https://raw.githubusercontent.com/$Repo/$Branch/install/pc"

Write-Host ""
Write-Host "  Noon Report - PC installer" -ForegroundColor Yellow
Write-Host "  Install folder: $InstallRoot"
Write-Host ""

New-Item -ItemType Directory -Force -Path $InstallRoot, $AppDir, $BinDir | Out-Null

$tmp = Join-Path $env:TEMP ("noonreport-pc-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp "repo.zip"

function Write-Utf8BomFile([string]$Path, [string]$Text) {
  $utf8Bom = New-Object System.Text.UTF8Encoding $true
  [System.IO.File]::WriteAllText($Path, $Text, $utf8Bom)
}

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

  $launcherNames = @(
    "Start-NoonReport.ps1",
    "Start-NoonReport.bat",
    "Update-NoonReport.ps1",
    "Update-NoonReport.bat",
    "install-pc.ps1"
  )
  foreach ($ln in $launcherNames) {
    $fromPc = Join-Path $src (Join-Path "install\pc" $ln)
    $destBin = Join-Path $BinDir $ln
    $destApp = Join-Path $AppDir $ln
    if (Test-Path -LiteralPath $fromPc) {
      Copy-Item -LiteralPath $fromPc -Destination $destBin -Force
      Copy-Item -LiteralPath $fromPc -Destination $destApp -Force
    } else {
      try {
        Invoke-WebRequest -Uri "$RawBase/$ln" -OutFile $destBin -UseBasicParsing
        Copy-Item -LiteralPath $destBin -Destination $destApp -Force
      } catch { }
    }

    # Ensure .ps1 launchers on disk use UTF-8 BOM for Windows PowerShell 5.1 -File
    if ($ln -like "*.ps1" -and (Test-Path -LiteralPath $destBin)) {
      $raw = [System.IO.File]::ReadAllText($destBin)
      Write-Utf8BomFile -Path $destBin -Text $raw
      Write-Utf8BomFile -Path $destApp -Text $raw
    }
  }

  $stamp = @{
    installedAt = (Get-Date).ToString("o")
    repo = $Repo
    branch = $Branch
    source = $ZipUrl
    mode = "local-pc"
  } | ConvertTo-Json
  Set-Content -LiteralPath (Join-Path $InstallRoot "install.json") -Value $stamp -Encoding UTF8

  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Noon Report.lnk"
  $bat = Join-Path $BinDir "Start-NoonReport.bat"
  if (Test-Path -LiteralPath $bat) {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($shortcutPath)
    $sc.TargetPath = $bat
    $sc.WorkingDirectory = $AppDir
    $sc.WindowStyle = 1
    $sc.Description = "Noon Report - local PC (offline-capable)"
    $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
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

  $startPs1 = Join-Path $BinDir "Start-NoonReport.ps1"
  if ((-not $NoStart) -and (Test-Path -LiteralPath $startPs1)) {
    Write-Host "Starting Noon Report..."
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $startPs1,
      "-AppDir", $AppDir
    )
  }
} finally {
  try {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  } catch { }
}

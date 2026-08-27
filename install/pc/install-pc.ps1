#Requires -Version 5.1
# Voyage Chief - one-click PC installer (local http://127.0.0.1, not the website).
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
Write-Host "  Voyage Chief - PC installer" -ForegroundColor Yellow
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

  $bat = (Resolve-Path -LiteralPath (Join-Path $BinDir "Start-NoonReport.bat")).Path
  $startPs1Path = Join-Path $BinDir "Start-NoonReport.ps1"

  function Get-DesktopDirs {
    $dirs = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in @(
      [Environment]::GetFolderPath("Desktop"),
      [Environment]::GetFolderPath("CommonDesktopDirectory"),
      (Join-Path $env:USERPROFILE "Desktop"),
      (Join-Path $env:USERPROFILE "OneDrive\Desktop"),
      (Join-Path $env:USERPROFILE "OneDrive - Personal\Desktop"),
      (Join-Path $env:PUBLIC "Desktop")
    )) {
      if ($candidate -and (Test-Path -LiteralPath $candidate) -and -not $dirs.Contains($candidate)) {
        $dirs.Add($candidate)
      }
    }
    return $dirs
  }

  function New-NoonReportShortcut([string]$LinkPath, [string]$TargetBat, [string]$WorkDir) {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($LinkPath)
    $sc.TargetPath = $TargetBat
    $sc.WorkingDirectory = $WorkDir
    $sc.WindowStyle = 1
    $sc.Description = "Voyage Chief - local PC (offline-capable)"
    $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
    $sc.Save()
  }

  $shortcutMade = $false
  if (Test-Path -LiteralPath $bat) {
    foreach ($desktop in (Get-DesktopDirs)) {
      try {
        $shortcutPath = Join-Path $desktop "Voyage Chief.lnk"
        New-NoonReportShortcut -LinkPath $shortcutPath -TargetBat $bat -WorkDir $AppDir
        # Also drop a plain .bat launcher on Desktop (works if .lnk is blocked)
        $deskBat = Join-Path $desktop "Voyage Chief.bat"
        $deskBatBody = @"
@echo off
start "" /D "$AppDir" powershell -NoProfile -ExecutionPolicy Bypass -File "$startPs1Path" -AppDir "$AppDir"
"@
        Set-Content -LiteralPath $deskBat -Value $deskBatBody -Encoding ASCII
        Write-Host "Desktop shortcut: $shortcutPath" -ForegroundColor Green
        Write-Host "Desktop launcher : $deskBat" -ForegroundColor Green
        $shortcutMade = $true
        break
      } catch {
        Write-Host ("Desktop shortcut failed in {0}: {1}" -f $desktop, $_.Exception.Message) -ForegroundColor DarkYellow
      }
    }

    # Start Menu shortcut
    try {
      $startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
      if (-not (Test-Path -LiteralPath $startMenu)) {
        New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
      }
      $smLink = Join-Path $startMenu "Voyage Chief.lnk"
      New-NoonReportShortcut -LinkPath $smLink -TargetBat $bat -WorkDir $AppDir
      Write-Host "Start Menu shortcut: $smLink" -ForegroundColor Green
      $shortcutMade = $true
    } catch {
      Write-Host ("Start Menu shortcut failed: {0}" -f $_.Exception.Message) -ForegroundColor DarkYellow
    }
  }

  if (-not $shortcutMade) {
    Write-Host "WARNING: could not create a Desktop shortcut. Start manually with:" -ForegroundColor Yellow
    Write-Host "  $bat"
  }

  Write-Host ""
  Write-Host "Installed successfully." -ForegroundColor Green
  Write-Host "  App files : $AppDir"
  Write-Host "  Start     : Desktop 'Voyage Chief' shortcut, or:"
  Write-Host "              $bat"
  Write-Host "  Update    : $BinDir\Update-NoonReport.bat"
  Write-Host ""
  Write-Host "This PC always runs locally (http://127.0.0.1). Online sync is optional under Data." -ForegroundColor DarkGray
  Write-Host ""

  $startPs1 = Join-Path $BinDir "Start-NoonReport.ps1"
  if ((-not $NoStart) -and (Test-Path -LiteralPath $startPs1)) {
    Write-Host "Starting Voyage Chief..."
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

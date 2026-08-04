#Requires -Version 5.1
<#
.SYNOPSIS
  Start Noon Report on this PC via a local http://127.0.0.1 server (offline-capable).
.DESCRIPTION
  Serves the app files from this folder (or the installed App folder) and opens the browser.
  Voyage data stays in the browser IndexedDB on this PC — same behavior every launch.
#>
param(
  [int]$Port = 8765,
  [string]$AppDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

function Get-AppRoot {
  if ($AppDir -and (Test-Path -LiteralPath $AppDir)) { return (Resolve-Path $AppDir).Path }
  if (Test-Path (Join-Path $ScriptDir "voyage_manager.html")) { return $ScriptDir }
  $installed = Join-Path $env:LOCALAPPDATA "NoonReport\app"
  if (Test-Path (Join-Path $installed "voyage_manager.html")) { return $installed }
  throw "Could not find voyage_manager.html. Run install-pc.ps1 first, or place this script next to the app files."
}

function Get-ContentType([string]$path) {
  switch -Regex ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '\.html?' { "text/html; charset=utf-8"; break }
    '\.js'    { "application/javascript; charset=utf-8"; break }
    '\.css'   { "text/css; charset=utf-8"; break }
    '\.json'  { "application/json; charset=utf-8"; break }
    '\.webmanifest' { "application/manifest+json; charset=utf-8"; break }
    '\.png'   { "image/png"; break }
    '\.jpg|\.jpeg' { "image/jpeg"; break }
    '\.svg'   { "image/svg+xml"; break }
    '\.ico'   { "image/x-icon"; break }
    '\.woff2' { "font/woff2"; break }
    '\.woff'  { "font/woff"; break }
    default   { "application/octet-stream" }
  }
}

$root = Get-AppRoot
if (-not (Test-Path (Join-Path $root "voyage_manager.html"))) {
  throw "voyage_manager.html missing in $root"
}

# Find a free port if the default is busy
function Test-PortFree([int]$p) {
  try {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
    $l.Start(); $l.Stop(); return $true
  } catch { return $false }
}
if (-not (Test-PortFree $Port)) {
  for ($p = 8766; $p -le 8799; $p++) {
    if (Test-PortFree $p) { $Port = $p; break }
  }
}

$prefix = "http://127.0.0.1:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Failed to bind $prefix — try running PowerShell as the same user, or choose another port." -ForegroundColor Red
  throw
}

$homeUrl = "${prefix}voyage_manager.html"
Write-Host ""
Write-Host "  Noon Report — local PC server" -ForegroundColor Yellow
Write-Host "  Folder : $root"
Write-Host "  URL    : $homeUrl"
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

Start-Process $homeUrl | Out-Null

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($rel) -or $rel.EndsWith('/')) { $rel = "voyage_manager.html" }
      $rel = $rel -replace '/', [IO.Path]::DirectorySeparatorChar
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $res.StatusCode = 404
        $buf = [Text.Encoding]::UTF8.GetBytes("Not found")
        $res.ContentLength64 = $buf.Length
        $res.OutputStream.Write($buf, 0, $buf.Length)
      } else {
        $bytes = [IO.File]::ReadAllBytes($full)
        $res.StatusCode = 200
        $res.ContentType = Get-ContentType $full
        $res.Headers.Add("Cache-Control", "no-cache")
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}

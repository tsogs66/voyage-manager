#Requires -Version 5.1
<#
.SYNOPSIS
  Start Voyage Chief on this PC via a local http://127.0.0.1 server (offline-capable).
.DESCRIPTION
  Serves the app files from this folder (or the installed App folder) and opens the browser.
  Voyage data stays in the browser IndexedDB on this PC - same behavior every launch.
#>
param(
  [int]$Port = 8765,
  [string]$AppDir = ""
)

$ErrorActionPreference = "Stop"

if ($PSScriptRoot) {
  $ScriptDir = $PSScriptRoot
} else {
  $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

function Get-AppRoot {
  if ($AppDir -and (Test-Path -LiteralPath $AppDir)) {
    return (Resolve-Path -LiteralPath $AppDir).Path
  }
  $localHtml = Join-Path $ScriptDir "voyage_manager.html"
  if (Test-Path -LiteralPath $localHtml) {
    return $ScriptDir
  }
  $installed = Join-Path $env:LOCALAPPDATA "NoonReport\app"
  $installedHtml = Join-Path $installed "voyage_manager.html"
  if (Test-Path -LiteralPath $installedHtml) {
    return $installed
  }
  throw "Could not find voyage_manager.html. Run install-pc.ps1 first, or place this script next to the app files."
}

function Get-ContentType([string]$path) {
  $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
  switch ($ext) {
    ".html" { return "text/html; charset=utf-8" }
    ".htm"  { return "text/html; charset=utf-8" }
    ".js"   { return "application/javascript; charset=utf-8" }
    ".css"  { return "text/css; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".webmanifest" { return "application/manifest+json; charset=utf-8" }
    ".png"  { return "image/png" }
    ".jpg"  { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".svg"  { return "image/svg+xml" }
    ".ico"  { return "image/x-icon" }
    ".woff2"{ return "font/woff2" }
    ".woff" { return "font/woff" }
    default { return "application/octet-stream" }
  }
}

function Test-PortFree([int]$p) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      try { $listener.Stop() } catch { }
    }
  }
}

$root = Get-AppRoot
$root = $root.TrimEnd('\', '/')
$htmlPath = Join-Path $root "voyage_manager.html"
if (-not (Test-Path -LiteralPath $htmlPath)) {
  throw "voyage_manager.html missing in $root"
}

if (-not (Test-PortFree -p $Port)) {
  $found = $false
  for ($p = 8766; $p -le 8799; $p++) {
    if (Test-PortFree -p $p) {
      $Port = $p
      $found = $true
      break
    }
  }
  if (-not $found) {
    throw "No free local port found between 8765 and 8799."
  }
}

$prefix = "http://127.0.0.1:$Port/"
$http = New-Object System.Net.HttpListener
$http.Prefixes.Add($prefix)

try {
  $http.Start()
} catch {
  Write-Host ("Failed to bind {0} - try another port or close the app already using it." -f $prefix) -ForegroundColor Red
  throw
}

$homeUrl = $prefix + "voyage_manager.html"
Write-Host ""
Write-Host "  Voyage Chief - local PC server" -ForegroundColor Yellow
Write-Host ("  Folder : {0}" -f $root)
Write-Host ("  URL    : {0}" -f $homeUrl)
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

Start-Process $homeUrl | Out-Null

try {
  while ($http.IsListening) {
    $ctx = $http.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($rel) -or $rel.EndsWith('/')) {
        $rel = "voyage_manager.html"
      }
      $rel = $rel.Replace('/', [IO.Path]::DirectorySeparatorChar)
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
      $underRoot = $full.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
      if (-not $underRoot -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $res.StatusCode = 404
        $buf = [Text.Encoding]::UTF8.GetBytes("Not found")
        $res.ContentLength64 = $buf.Length
        $res.OutputStream.Write($buf, 0, $buf.Length)
      } else {
        $bytes = [IO.File]::ReadAllBytes($full)
        $res.StatusCode = 200
        $res.ContentType = Get-ContentType $full
        $res.AddHeader("Cache-Control", "no-cache")
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      try { $res.StatusCode = 500 } catch { }
    } finally {
      try { $res.OutputStream.Close() } catch { }
    }
  }
} finally {
  try { $http.Stop() } catch { }
  try { $http.Close() } catch { }
}

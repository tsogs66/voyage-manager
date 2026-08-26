#!/usr/bin/env bash
# Build the Noon Report Windows installer (NoonReport-Setup-<version>.exe).
#
# makensis runs on Linux, so the release is produced by CI without a Windows
# machine. The installer itself is a normal Windows .exe: per-user, no admin
# rights, no bundled runtime, and it works with no internet connection.
#
#   bash scripts/build-windows-installer.sh [out_dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Resolve the output directory to an absolute path before anything uses it.
# NSIS resolves a relative OutFile against the .nsi file's own directory rather
# than the working directory, so passing a relative "dist" here made makensis try
# to write into install/windows/dist and fail with "Can't open output file" —
# while the default (an absolute path) worked, which is what hid it.
OUT_DIR_ARG="${1:-$ROOT/dist}"
mkdir -p "$OUT_DIR_ARG"
OUT_DIR="$(cd "$OUT_DIR_ARG" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if ! command -v makensis >/dev/null 2>&1; then
  echo "makensis not found. Install NSIS:" >&2
  echo "  Debian/Ubuntu : apt-get install -y nsis" >&2
  echo "  macOS         : brew install makensis" >&2
  exit 1
fi

# Version the installer by the service-worker cache, which is bumped on every
# release anyway — so the .exe on disk names the build it carries instead of a
# number someone has to remember to raise separately.
CACHE="$(sed -n "s/^const CACHE = 'noon-report-v\([0-9]\+\)';.*/\1/p" "$ROOT/sw.js")"
if [[ -z "$CACHE" ]]; then
  echo "Could not read the cache version from sw.js" >&2
  exit 1
fi
VERSION="1.0.${CACHE}"

PAYLOAD="$WORK/payload"
mkdir -p "$PAYLOAD" "$OUT_DIR"

# The app itself, from the list every package shares.
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  cp "$ROOT/$f" "$PAYLOAD/"
done < <(python3 -c "import json;print('\n'.join(json.load(open('$ROOT/scripts/app-assets.json'))['files']))")
while IFS= read -r d; do
  [[ -n "$d" ]] || continue
  mkdir -p "$PAYLOAD/$d"
  cp -r "$ROOT/$d/." "$PAYLOAD/$d/"
done < <(python3 -c "import json;print('\n'.join(json.load(open('$ROOT/scripts/app-assets.json'))['dirs']))")

# The launcher: a loopback HTTP server in PowerShell, which every supported
# Windows already has. It has to be a server rather than opening the file
# directly — a page opened from file:// is not a secure origin, so the service
# worker that makes the app work offline will not register, and browsers treat
# its storage as a different origin on every launch.
cp "$ROOT/install/pc/Start-NoonReport.ps1" "$PAYLOAD/"
cp "$ROOT/install/pc/Start-NoonReport.bat" "$PAYLOAD/Start Noon Report.bat"
cp "$ROOT/install/pc/Update-NoonReport.ps1" "$PAYLOAD/"
cp "$ROOT/install/pc/Update-NoonReport.bat" "$PAYLOAD/"
cp "$ROOT/install/pc/install-pc.ps1" "$PAYLOAD/"
cp "$ROOT/install/windows/README.txt" "$PAYLOAD/README.txt"

OUT_EXE="$OUT_DIR/NoonReport-Setup-${VERSION}.exe"
rm -f "$OUT_EXE"

makensis -V2 \
  "-DAPP_VERSION=$VERSION" \
  "-DOUT_FILE=$OUT_EXE" \
  "-DPAYLOAD_DIR=$PAYLOAD" \
  "$ROOT/install/windows/noonreport.nsi"

if [[ ! -f "$OUT_EXE" ]]; then
  echo "makensis reported success but produced no installer" >&2
  exit 1
fi

SIZE="$(du -h "$OUT_EXE" | cut -f1)"
echo
echo "Windows installer : $OUT_EXE"
echo "Version           : $VERSION  (from $(basename "$ROOT")/sw.js cache v$CACHE)"
echo "Size              : $SIZE"
echo "Installs to       : %LOCALAPPDATA%\\NoonReport  (no administrator rights)"

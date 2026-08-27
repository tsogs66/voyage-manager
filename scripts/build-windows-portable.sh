#!/usr/bin/env bash
# Build the Voyage Chief portable Windows package (VoyageChief-Portable-<version>.exe).
#
# Unlike the Setup installer this writes nothing to the PC: the .exe unpacks a
# VoyageChief folder next to itself (a USB stick, a shared drive) and starts
# from there. makensis runs on Linux, so CI can produce it without Windows.
#
#   bash scripts/build-windows-portable.sh [out_dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

CACHE="$(sed -n "s/^const CACHE = 'noon-report-v\([0-9]\+\)';.*/\1/p" "$ROOT/sw.js")"
if [[ -z "$CACHE" ]]; then
  echo "Could not read the cache version from sw.js" >&2
  exit 1
fi
VERSION="1.0.${CACHE}"

PAYLOAD="$WORK/payload"
mkdir -p "$PAYLOAD" "$OUT_DIR"

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  cp "$ROOT/$f" "$PAYLOAD/"
done < <(python3 -c "import json;print('\n'.join(json.load(open('$ROOT/scripts/app-assets.json'))['files']))")
while IFS= read -r d; do
  [[ -n "$d" ]] || continue
  mkdir -p "$PAYLOAD/$d"
  cp -r "$ROOT/$d/." "$PAYLOAD/$d/"
done < <(python3 -c "import json;print('\n'.join(json.load(open('$ROOT/scripts/app-assets.json'))['dirs']))")

cp "$ROOT/install/pc/Start-NoonReport.ps1" "$PAYLOAD/"
cp "$ROOT/install/pc/Start-NoonReport.bat" "$PAYLOAD/Start Voyage Chief.bat"
# A stick in an engine-control room does not fetch GitHub. Leave the update
# scripts off this package so nobody double-clicks them expecting the USB
# copy to refresh itself over a satellite link.
cp "$ROOT/install/windows/PORTABLE-README.txt" "$PAYLOAD/README.txt"

OUT_EXE="$OUT_DIR/VoyageChief-Portable-${VERSION}.exe"
rm -f "$OUT_EXE"

makensis -V2 \
  "-DAPP_VERSION=$VERSION" \
  "-DOUT_FILE=$OUT_EXE" \
  "-DPAYLOAD_DIR=$PAYLOAD" \
  "$ROOT/install/windows/portable.nsi"

if [[ ! -f "$OUT_EXE" ]]; then
  echo "makensis reported success but produced no portable package" >&2
  exit 1
fi

SIZE="$(du -h "$OUT_EXE" | cut -f1)"
echo
echo "Windows portable : $OUT_EXE"
echo "Version          : $VERSION  (from $(basename "$ROOT")/sw.js cache v$CACHE)"
echo "Size             : $SIZE"
echo "Unpacks to       : <folder-of-the-exe>\\VoyageChief  (USB stick, no install)"

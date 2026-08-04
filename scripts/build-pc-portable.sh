#!/usr/bin/env bash
# Build a one-folder portable PC zip (double-click Start Noon Report.bat).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist/NoonReport-PC}"
ZIP="${2:-$ROOT/dist/NoonReport-PC.zip}"

rm -rf "$OUT"
mkdir -p "$OUT/icons" "$(dirname "$ZIP")"

cp "$ROOT/voyage_manager.html" "$OUT/"
cp "$ROOT/sw.js" "$OUT/"
cp "$ROOT/manifest.webmanifest" "$OUT/"
cp -r "$ROOT/icons/." "$OUT/icons/"
cp "$ROOT/install/pc/Start-NoonReport.ps1" "$OUT/"
cp "$ROOT/install/pc/Start-NoonReport.bat" "$OUT/Start Noon Report.bat"
cp "$ROOT/install/pc/Update-NoonReport.ps1" "$OUT/"
cp "$ROOT/install/pc/Update-NoonReport.bat" "$OUT/"
cp "$ROOT/install/pc/README.txt" "$OUT/"

# Portable update still uses GitHub; keep install-pc.ps1 for updates
cp "$ROOT/install/pc/install-pc.ps1" "$OUT/"

rm -f "$ZIP"
if command -v zip >/dev/null 2>&1; then
  (cd "$(dirname "$OUT")" && zip -r "$(basename "$ZIP")" "$(basename "$OUT")" >/dev/null)
else
  python3 - <<PY
import pathlib, zipfile
out = pathlib.Path("$OUT")
zip_path = pathlib.Path("$ZIP")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for p in out.rglob("*"):
        if p.is_file():
            z.write(p, p.relative_to(out.parent).as_posix())
print("wrote", zip_path)
PY
fi

echo "Portable PC package: $OUT"
echo "Zip: $ZIP"
echo "Share link (after push/release): download the zip and run Start Noon Report.bat"

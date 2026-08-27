#!/usr/bin/env bash
# Build a one-folder portable PC zip (double-click Start Voyage Report.bat).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist/VoyageReport-PC}"
ZIP="${2:-$ROOT/dist/VoyageReport-PC.zip}"

rm -rf "$OUT"
mkdir -p "$OUT" "$(dirname "$ZIP")"

# Copy from the shared asset list rather than naming files here. This block used to
# be hand-maintained and had gone stale: eorb.js and ship_time.js were never copied,
# so every portable download 404'd on both and ran without the e-ORB module or the
# ship-time logic.
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  cp "$ROOT/$f" "$OUT/"
done < <(python3 -c "import json;print('\n'.join(json.load(open('$ROOT/scripts/app-assets.json'))['files']))")
while IFS= read -r d; do
  [[ -n "$d" ]] || continue
  mkdir -p "$OUT/$d"
  cp -r "$ROOT/$d/." "$OUT/$d/"
done < <(python3 -c "import json;print('\n'.join(json.load(open('$ROOT/scripts/app-assets.json'))['dirs']))")

cp "$ROOT/install/pc/Start-NoonReport.ps1" "$OUT/"
cp "$ROOT/install/pc/Start-NoonReport.bat" "$OUT/Start Voyage Report.bat"
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
echo "Share link (after push/release): download the zip and run Start Voyage Report.bat"

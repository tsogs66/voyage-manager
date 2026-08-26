#!/usr/bin/env bash
# Refresh fonts/ from Google Fonts.
#
# The app and its printed reports are set in Oswald, IBM Plex Mono and Inter. They
# are served from fonts/ rather than from fonts.googleapis.com because the app runs
# on ships with no internet: loading them from Google meant every launch stalled on
# a request that could never succeed, and every report printed from that session
# fell back to whatever the PC happened to have.
#
# Run this only to pick up upstream font revisions; the files are committed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
URL="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
# The user agent decides the format Google serves: an old one gets .ttf, which is
# roughly three times the size for the same glyphs.
curl -fsS -m 60 -A "$UA" -o "$TMP" "$URL"
grep -q woff2 "$TMP" || { echo "Google served no woff2 — check the user agent" >&2; exit 1; }

python3 - "$TMP" "$ROOT/fonts" <<'PY'
import re, sys, os, pathlib, urllib.request

css_path, out = sys.argv[1], pathlib.Path(sys.argv[2])
out.mkdir(exist_ok=True)
css = open(css_path).read()

# Latin and Latin-Extended only. Cyrillic, Greek and Vietnamese would triple the
# payload for glyphs a noon report never prints; Latin-Extended stays because ship
# names and ports carry accents.
KEEP = {'latin', 'latin-ext'}

proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({'https': proxy, 'http': proxy})) if proxy else urllib.request.build_opener()

kept, seen = [], {}
for b in re.split(r'(?=/\* [a-z-]+ \*/)', css):
    m = re.match(r'/\* ([a-z-]+) \*/', b.strip())
    if not m or m.group(1) not in KEEP:
        continue
    fam = re.search(r"font-family: '([^']+)'", b).group(1)
    wt  = re.search(r'font-weight: (\d+)', b).group(1)
    url = re.search(r'url\((https://[^)]+\.woff2)\)', b).group(1)
    name = f"{fam.replace(' ', '')}-{wt}-{m.group(1)}.woff2"
    if name not in seen:
        (out / name).write_bytes(opener.open(url, timeout=60).read())
        seen[name] = True
    kept.append(b.replace(url, name))

header = """/*
 * The three faces the app and its printed reports are set in, served from this
 * folder instead of from fonts.googleapis.com.
 *
 * A ship has no internet. Loading these from Google meant every launch stalled on
 * a request that could never succeed, and the app — and every report printed from
 * it — fell back to whatever the PC happened to have. The typography of a report
 * that gets signed and filed should not depend on the vessel's connectivity.
 *
 * Latin and Latin-Extended subsets only: the cyrillic, greek and vietnamese
 * subsets Google also serves would triple the payload for glyphs a noon report
 * never prints.
 *
 * Regenerate with: bash scripts/fetch-fonts.sh
 */
"""
(out / 'fonts.css').write_text(header + ''.join(kept))
print(f"{len(seen)} woff2 files + fonts.css written to {out}")
PY

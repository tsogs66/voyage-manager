#!/usr/bin/env bash
# The nginx request-body limit for voyage sync, checked against a real config file.
#
# Guards a failure seen on a ship: nginx's 1 MB default applied to the sync
# vhost, a full voyage push (entries, receipts, e-ORB records, the vessel stamp,
# the chief engineer's signature and any uploaded documents in one PUT) exceeded
# it, and nginx answered with its own HTML "413 Request Entity Too Large" page
# before the request ever reached voyage-sync. The installer now writes
# client_max_body_size, and proxmox-update.sh patches installs that predate it —
# so an existing ship is fixed by a plain update, not a reinstall.
#
# Run: bash tests/test_nginx_upload_limit.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$REPO_ROOT/install/proxmox-install.sh"
UPDATER="$REPO_ROOT/install/proxmox-update.sh"

failures=0
checks=0

check(){
  local label="$1" actual="$2" expected="$3"
  checks=$((checks + 1))
  if [[ "$actual" == "$expected" ]]; then
    echo "  ok   $label"
  else
    echo "  FAIL $label"
    echo "         expected: $expected"
    echo "         actual:   $actual"
    failures=$((failures + 1))
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# A vhost as the installer wrote it BEFORE the limit was added — what a ship
# already at sea has on disk.
cat > "$WORK/old-conf" <<'CONF'
server {
    listen 8080;
    listen [::]:8080;
    server_name _;
    root /opt/voyage-manager;
    index voyage_manager.html;

    location / {
        try_files $uri $uri/ /voyage_manager.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_intercept_errors on;
        error_page 502 503 504 = @api_upstream_down;
    }

    location @api_upstream_down {
        default_type application/json;
        return 502 '{"ok":false,"error":"sync server unavailable"}';
    }
}
CONF

# Sourcing the updater would run main() and try to rebuild the container, so
# neuter its entry point and call the one function under test.
sed 's/^main "$@"$/:/' "$UPDATER" > "$WORK/lib.sh"

# Count only the directive. The 413 handler's JSON message also contains the
# words "client_max_body_size", and a loose grep here would pass while the
# config carried three copies of the directive.
count_directive(){ grep -cE '^[[:space:]]*client_max_body_size' "$1"; }

run_patch(){
  local conf="$1" nginx_exit="$2"
  printf '#!/bin/sh\nexit %s\n' "$nginx_exit" > "$WORK/bin/nginx"
  chmod +x "$WORK/bin/nginx"
  PATH="$WORK/bin:$PATH" bash -c "
    source '$WORK/lib.sh'
    eval \"\$(declare -f patch_nginx_upload_limit | sed 's#/etc/nginx/sites-available/voyage-manager#${conf}#')\"
    patch_nginx_upload_limit
  " 2>&1 | sed 's/^/         | /'
}

# Did the helper decide there was work to do?
patched_this_run(){ grep -qc "Raising the nginx upload limit" <<<"$1"; }

echo "installer template"
check "installer sets client_max_body_size" \
  "$(grep -cE '^[[:space:]]*client_max_body_size' "$INSTALLER")" "1"
check "installer answers 413 with JSON, not nginx's HTML page" \
  "$(grep -c 'location @api_too_large' "$INSTALLER")" "1"
# 413 is raised by nginx before proxy_pass runs, so proxy_intercept_errors never
# sees it — it needs its own error_page or the app gets an HTML body.
check "413 has its own error_page" \
  "$(grep -c 'error_page 413 = @api_too_large;' "$INSTALLER")" "1"

echo
echo "patching an install that predates the limit"
cp "$WORK/old-conf" "$WORK/conf"
first_out="$(run_patch "$WORK/conf" 0)"
check "the helper reports it is patching" \
  "$(grep -qc 'Raising the nginx upload limit' <<<"$first_out" && echo yes || echo no)" "yes"
check "directive inserted exactly once" "$(count_directive "$WORK/conf")" "1"
check "413 handler inserted" "$(grep -c 'location @api_too_large' "$WORK/conf")" "1"
check "server block still closed exactly once" "$(grep -c '^}' "$WORK/conf")" "1"
check "the original was backed up" "$(ls "$WORK"/conf.bak.* 2>/dev/null | wc -l)" "1"
check "the limit lands inside the server block" \
  "$(awk '/^server \{/{s=1} /^\}/{s=0} s && /^[[:space:]]*client_max_body_size/{n++} END{print n+0}' "$WORK/conf")" "1"

echo
echo "running the updater again"
# An update is run repeatedly over a ship's life; each run must be a no-op once
# the config is already correct, or the vhost grows a duplicate directive a run.
cp "$WORK/conf" "$WORK/conf.patched"
again_out="$(run_patch "$WORK/conf" 0)"
run_patch "$WORK/conf" 0 >/dev/null
check "directive still appears once after three runs" "$(count_directive "$WORK/conf")" "1"
check "413 handler still appears once" "$(grep -c 'location @api_too_large' "$WORK/conf")" "1"
check "config byte-identical after re-running" \
  "$(cmp -s "$WORK/conf.patched" "$WORK/conf" && echo same || echo changed)" "same"
check "the helper skips an already-patched config" \
  "$(grep -qc 'Raising the nginx upload limit' <<<"$again_out" && echo patched || echo skipped)" "skipped"

echo
echo "half-patched config"
# Hand-edited installs exist: someone raised the limit but has no 413 handler.
rm -f "$WORK"/conf.bak.*
sed '/index voyage_manager.html;/a\
\
    client_max_body_size 64m;' "$WORK/old-conf" > "$WORK/conf"
run_patch "$WORK/conf" 0
check "existing directive not duplicated" "$(count_directive "$WORK/conf")" "1"
check "missing 413 handler added" "$(grep -c 'location @api_too_large' "$WORK/conf")" "1"
check "server block still closed exactly once" "$(grep -c '^}' "$WORK/conf")" "1"

echo
echo "nginx rejects the patched config"
# Never leave a ship with a vhost nginx will not load — that takes the whole app
# offline, which is worse than the 413 this fixes.
rm -f "$WORK"/conf.bak.*
cp "$WORK/old-conf" "$WORK/conf"
run_patch "$WORK/conf" 1
if diff -q "$WORK/old-conf" "$WORK/conf" >/dev/null 2>&1; then
  check "config restored from backup" "restored" "restored"
else
  check "config restored from backup" "left modified" "restored"
fi

echo
echo "app-side error message"
APP="$REPO_ROOT/voyage_manager.html"
# The ship was told to fix a URL that was correct, because any HTML body was
# reported as a wrong URL whatever the status line said.
check "413 is named before the HTML fallback runs" \
  "$(awk '/res.status === 413/{if(!a) a=NR} /Sync server returned a web page/{if(!b) b=NR} END{print (a && b && a < b) ? "yes" : "no"}' "$APP")" "yes"
check "the 413 message names the nginx directive to raise" \
  "$(grep -c 'client_max_body_size (the installer sets 64m' "$APP")" "1"
# Both a bare nginx (HTML body) and a patched proxy (JSON body) return 413, and
# they take different branches — both must reach the same message.
check "both 413 branches share one message builder" \
  "$(grep -c 'throw new Error(syncTooLargeMessage(opts));' "$APP")" "2"

echo
if (( failures > 0 )); then
  echo "FAILED — $failures of $checks checks"
  exit 1
fi
echo "PASSED — $checks checks"

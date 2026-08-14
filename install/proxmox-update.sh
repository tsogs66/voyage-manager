#!/usr/bin/env bash
# Noon Report / Voyage Manager — pull latest from GitHub and restart services
#
# From Proxmox host (auto-finds CT from /root/voyage-manager-ct*.env if VOYAGE_CTID unset):
#   curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | bash
#
# From Proxmox host with explicit container ID:
#   VOYAGE_CTID=120 curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | bash
#
# Inside an existing LXC container:
#   curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | VOYAGE_IN_CONTAINER=1 bash
#
# Or via pct:
#   pct exec 120 -- bash -c "curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | VOYAGE_IN_CONTAINER=1 bash"
set -euo pipefail

REPO_URL="${VOYAGE_REPO_URL:-https://github.com/tsogs66/voyage-manager.git}"
INSTALL_DIR="${VOYAGE_INSTALL_DIR:-/opt/voyage-manager}"
BRANCH="${VOYAGE_BRANCH:-main}"
WEB_USER="${VOYAGE_WEB_USER:-www-data}"
SCRIPT_URL="${VOYAGE_UPDATE_SCRIPT_URL:-https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh}"

log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

is_proxmox_host(){
  [[ -d /etc/pve ]] && command -v pct >/dev/null 2>&1
}

is_inside_lxc(){
  [[ "${VOYAGE_IN_CONTAINER:-}" == "1" ]] && return 0
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    [[ "$(systemd-detect-virt -c 2>/dev/null || true)" == "lxc" ]] && return 0
  fi
  grep -qa 'container=lxc' /proc/1/environ 2>/dev/null
}

ensure_root(){
  [[ $EUID -eq 0 ]] || die "Run as root"
}

find_ctid_from_creds(){
  local f ctid
  for f in /root/voyage-manager-ct*.env; do
    [[ -f "$f" ]] || continue
    ctid="$(grep -E '^VOYAGE_CTID=' "$f" 2>/dev/null | cut -d= -f2- | tr -d ' \"' || true)"
    if [[ -n "$ctid" ]] && pct status "$ctid" >/dev/null 2>&1; then
      echo "$ctid"
      return 0
    fi
  done
  return 1
}

# Ask the restarted server whether its API token actually reached the process.
# server.py 1.4+ reports this on /api/health; older builds omit the field. Prints a
# warning block for the summary, or nothing when all is well.
check_sync_token(){
  local port="${VOYAGE_SYNC_PORT:-8787}"
  local payload
  # The counter is only a bound, never read.
  for _ in $(seq 1 15); do
    payload="$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)"
    if [[ -n "$payload" ]]; then
      if printf '%s' "$payload" | python3 -c \
        'import json,sys; sys.exit(0 if json.load(sys.stdin).get("tokenConfigured", True) else 1)' 2>/dev/null; then
        return 0
      fi
      cat <<'WARN'

 !! SYNC_API_TOKEN is not reaching the sync server.
    It accepts EVERY request — anyone who can reach the URL can read and
    overwrite voyage data. Check what the unit passes:

      systemctl show voyage-sync -p Environment

    Then set it (quote the value, and write any literal % as %%):

      mkdir -p /etc/systemd/system/voyage-sync.service.d
      printf '[Service]\nEnvironment="SYNC_API_TOKEN=<your token>"\n' \
        > /etc/systemd/system/voyage-sync.service.d/token.conf
      systemctl daemon-reload && systemctl restart voyage-sync
WARN
      return 0
    fi
    sleep 1
  done
  printf '\n !! Could not reach the sync server after restart — check: systemctl status voyage-sync\n'
}

ensure_git_safe_directory(){
  local dir="$1"
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$dir"; then
    git config --global --add safe.directory "$dir"
  fi
}

update_in_container(){
  ensure_root

  command -v git >/dev/null 2>&1 || die "git not installed — run the full install script first"

  [[ -d "$INSTALL_DIR/.git" ]] || die "No git repo at $INSTALL_DIR — run the full install script first"

  ensure_git_safe_directory "$INSTALL_DIR"

  log "Pulling latest from $BRANCH..."
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"

  local commit
  commit="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
  log "Now at commit $commit"

  chown -R "$WEB_USER:$WEB_USER" "$INSTALL_DIR" 2>/dev/null || true
  mkdir -p "${INSTALL_DIR}/sync-server/sync-data"
  chmod 750 "${INSTALL_DIR}/sync-server/sync-data"

  if systemctl is-enabled nginx >/dev/null 2>&1; then
    log "Reloading nginx..."
    nginx -t
    systemctl reload nginx
  fi

  local token_warning=""
  if systemctl is-enabled voyage-sync >/dev/null 2>&1; then
    log "Restarting voyage-sync..."
    systemctl restart voyage-sync
    token_warning="$(check_sync_token)"
  fi

  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  local web_port="${VOYAGE_WEB_PORT:-8080}"

  cat <<EOF

================================================================================
 Noon Report updated
================================================================================

 Commit:       $commit
 Web app:      http://${ip:-localhost}:${web_port}/voyage_manager.html
 Install dir:  ${INSTALL_DIR}

 Hard-refresh the browser (Ctrl+Shift+R) to load the new version.
 Sync data and API token are unchanged.
${token_warning}
================================================================================
EOF
}

update_via_proxmox(){
  ensure_root
  is_proxmox_host || die "Not a Proxmox host — set VOYAGE_IN_CONTAINER=1 to update inside a container"

  local ctid="${VOYAGE_CTID:-}"
  if [[ -z "$ctid" ]]; then
    ctid="$(find_ctid_from_creds || true)"
  fi
  [[ -n "$ctid" ]] || die "Set VOYAGE_CTID=<id> or ensure /root/voyage-manager-ct<ID>.env exists"

  pct status "$ctid" >/dev/null 2>&1 || die "Container CT $ctid not found"

  log "Updating Noon Report inside CT $ctid..."
  pct exec "$ctid" -- env \
    VOYAGE_IN_CONTAINER=1 \
    VOYAGE_REPO_URL="$REPO_URL" \
    VOYAGE_INSTALL_DIR="$INSTALL_DIR" \
    VOYAGE_BRANCH="$BRANCH" \
    VOYAGE_WEB_PORT="${VOYAGE_WEB_PORT:-8080}" \
    VOYAGE_SYNC_PORT="${VOYAGE_SYNC_PORT:-8787}" \
    bash -c "curl -fsSL '$SCRIPT_URL' | bash"
}

main(){
  if is_inside_lxc; then
    update_in_container
  elif is_proxmox_host; then
    update_via_proxmox
  else
    die "Run on a Proxmox host, or inside the voyage-manager LXC with VOYAGE_IN_CONTAINER=1"
  fi
}

main "$@"

#!/usr/bin/env bash
# Noon Report / Voyage Manager — Proxmox host installer
# Creates a new LXC container and installs the app inside it.
#
# Run on the Proxmox host (as root):
#   curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-install.sh | bash
#
# Re-run app install only inside an existing container:
#   VOYAGE_IN_CONTAINER=1 curl -fsSL ... | bash
set -euo pipefail

REPO_URL="${VOYAGE_REPO_URL:-https://github.com/tsogs66/voyage-manager.git}"
INSTALL_DIR="${VOYAGE_INSTALL_DIR:-/opt/voyage-manager}"
WEB_PORT="${VOYAGE_WEB_PORT:-8080}"
SYNC_PORT="${VOYAGE_SYNC_PORT:-8787}"
SYNC_TOKEN="${VOYAGE_SYNC_TOKEN:-}"
WEB_USER="${VOYAGE_WEB_USER:-www-data}"
BRANCH="${VOYAGE_BRANCH:-main}"

# LXC provisioning (Proxmox host only)
VOYAGE_CTID="${VOYAGE_CTID:-}"
VOYAGE_HOSTNAME="${VOYAGE_HOSTNAME:-voyage-manager}"
VOYAGE_MEMORY="${VOYAGE_MEMORY:-1024}"
VOYAGE_CORES="${VOYAGE_CORES:-1}"
VOYAGE_DISK_GB="${VOYAGE_DISK_GB:-8}"
VOYAGE_STORAGE="${VOYAGE_STORAGE:-local-lvm}"
VOYAGE_BRIDGE="${VOYAGE_BRIDGE:-vmbr0}"
VOYAGE_TEMPLATE_MATCH="${VOYAGE_TEMPLATE_MATCH:-debian-12-standard}"
VOYAGE_UNPRIVILEGED="${VOYAGE_UNPRIVILEGED:-1}"
SCRIPT_URL="${VOYAGE_SCRIPT_URL:-https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-install.sh}"

log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

ensure_git_safe_directory(){
  local dir="$1"
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$dir"; then
    git config --global --add safe.directory "$dir"
  fi
}

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
  [[ $EUID -eq 0 ]] || die "Run as root on the Proxmox host: curl ... | bash"
}

ensure_sync_token(){
  if [[ -z "$SYNC_TOKEN" ]]; then
    SYNC_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    log "Generated SYNC_API_TOKEN (save this): $SYNC_TOKEN"
  fi
}

find_debian_template(){
  local volid
  volid="$(pveam list local 2>/dev/null | awk -v m="$VOYAGE_TEMPLATE_MATCH" '$0 ~ m {print $1; exit}')"
  if [[ -n "$volid" ]]; then
    echo "$volid"
    return 0
  fi
  log "No local template matching '$VOYAGE_TEMPLATE_MATCH' — downloading..."
  pveam update
  local avail
  avail="$(pveam available --section system 2>/dev/null | awk -v m="$VOYAGE_TEMPLATE_MATCH" '$0 ~ m {print $1; exit}')"
  [[ -n "$avail" ]] || die "Could not find a Debian template. Download one manually: pveam download local <template>"
  pveam download local "$avail"
  volid="$(pveam list local 2>/dev/null | awk -v m="$VOYAGE_TEMPLATE_MATCH" '$0 ~ m {print $1; exit}')"
  [[ -n "$volid" ]] || die "Template download failed"
  echo "$volid"
}

pick_ctid(){
  if [[ -n "$VOYAGE_CTID" ]]; then
    pct status "$VOYAGE_CTID" >/dev/null 2>&1 && die "CT $VOYAGE_CTID already exists — set another VOYAGE_CTID or destroy the old container"
    echo "$VOYAGE_CTID"
    return 0
  fi
  if command -v pvesh >/dev/null 2>&1; then
    local next
    next="$(pvesh get /cluster/nextid 2>/dev/null || true)"
    if [[ -n "$next" ]]; then
      echo "$next"
      return 0
    fi
  fi
  local id
  for id in $(seq 100 999); do
    if ! pct status "$id" >/dev/null 2>&1; then
      echo "$id"
      return 0
    fi
  done
  die "No free container ID found between 100-999"
}

wait_for_container_network(){
  local ctid="$1" tries=30 ip=""
  log "Waiting for container network..."
  while (( tries-- > 0 )); do
    ip="$(pct exec "$ctid" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
    sleep 2
  done
  echo ""
}

install_in_container(){
  ensure_root
  ensure_sync_token

  export DEBIAN_FRONTEND=noninteractive
  log "Installing packages inside container..."
  apt-get update -qq
  apt-get install -y -qq git python3 nginx openssl ca-certificates curl

  log "Cloning repository to $INSTALL_DIR..."
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    ensure_git_safe_directory "$INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi

  log "Configuring nginx on port $WEB_PORT..."
  cat > /etc/nginx/sites-available/voyage-manager <<NGINX
server {
    listen ${WEB_PORT};
    listen [::]:${WEB_PORT};
    server_name _;
    root ${INSTALL_DIR};
    index voyage_manager.html;

    location / {
        try_files \$uri \$uri/ /voyage_manager.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${SYNC_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

  ln -sf /etc/nginx/sites-available/voyage-manager /etc/nginx/sites-enabled/voyage-manager
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl restart nginx

  log "Creating sync server service..."
  cat > /etc/systemd/system/voyage-sync.service <<UNIT
[Unit]
Description=Noon Report Sync Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/sync-server
Environment=SYNC_API_TOKEN=${SYNC_TOKEN}
Environment=SYNC_PORT=${SYNC_PORT}
Environment=SYNC_DATA_DIR=${INSTALL_DIR}/sync-server/sync-data
Environment=SYNC_HOST=127.0.0.1
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/sync-server/server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable voyage-sync
  systemctl restart voyage-sync

  chown -R "$WEB_USER:$WEB_USER" "$INSTALL_DIR" 2>/dev/null || true
  ensure_git_safe_directory "$INSTALL_DIR"
  mkdir -p "${INSTALL_DIR}/sync-server/sync-data"
  chmod 750 "${INSTALL_DIR}/sync-server/sync-data"

  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"

  cat <<EOF

================================================================================
 Noon Report installed inside container
================================================================================

 Web app:      http://${ip:-localhost}:${WEB_PORT}/voyage_manager.html
 Sync API:     http://${ip:-localhost}:${WEB_PORT}/api/health
 API token:    ${SYNC_TOKEN}

 App sync settings (Data tab):
   Sync Server URL:  http://${ip:-localhost}:${WEB_PORT}
   API Token:        ${SYNC_TOKEN}

================================================================================
EOF
}

provision_lxc_on_proxmox(){
  ensure_root
  ensure_sync_token

  command -v pveam >/dev/null 2>&1 || die "pveam not found — run this script on a Proxmox VE host"

  local template ctid creds_file
  template="$(find_debian_template)"
  ctid="$(pick_ctid)"
  creds_file="/root/voyage-manager-ct${ctid}.env"

  log "Creating LXC container CT $ctid ($VOYAGE_HOSTNAME)..."
  log "  Template: $template"
  log "  Storage:  ${VOYAGE_STORAGE}:${VOYAGE_DISK_GB}"
  log "  Bridge:   $VOYAGE_BRIDGE"

  local unpriv_flag=()
  [[ "$VOYAGE_UNPRIVILEGED" == "1" ]] && unpriv_flag=(--unprivileged 1)

  pct create "$ctid" "$template" \
    --hostname "$VOYAGE_HOSTNAME" \
    --memory "$VOYAGE_MEMORY" \
    --cores "$VOYAGE_CORES" \
    --rootfs "${VOYAGE_STORAGE}:${VOYAGE_DISK_GB}" \
    --net0 "name=eth0,bridge=${VOYAGE_BRIDGE},ip=dhcp" \
    --onboot 1 \
    "${unpriv_flag[@]}"

  log "Starting CT $ctid..."
  pct start "$ctid"
  sleep 3

  log "Bootstrapping container (curl, git)..."
  pct exec "$ctid" -- bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq curl ca-certificates git'

  log "Running app installer inside CT $ctid..."
  pct exec "$ctid" -- env \
    VOYAGE_IN_CONTAINER=1 \
    VOYAGE_SYNC_TOKEN="$SYNC_TOKEN" \
    VOYAGE_REPO_URL="$REPO_URL" \
    VOYAGE_INSTALL_DIR="$INSTALL_DIR" \
    VOYAGE_WEB_PORT="$WEB_PORT" \
    VOYAGE_SYNC_PORT="$SYNC_PORT" \
    VOYAGE_BRANCH="$BRANCH" \
    bash -c "curl -fsSL '$SCRIPT_URL' | bash"

  local ct_ip
  ct_ip="$(wait_for_container_network "$ctid")"

  cat > "$creds_file" <<CREDS
# Noon Report — CT ${ctid} (${VOYAGE_HOSTNAME})
VOYAGE_CTID=${ctid}
VOYAGE_WEB_URL=http://${ct_ip:-<container-ip>}:${WEB_PORT}/voyage_manager.html
VOYAGE_SYNC_URL=http://${ct_ip:-<container-ip>}:${WEB_PORT}
SYNC_API_TOKEN=${SYNC_TOKEN}
CREDS
  chmod 600 "$creds_file"

  cat <<EOF

================================================================================
 Proxmox LXC created and Noon Report installed
================================================================================

 Container:    CT ${ctid} (${VOYAGE_HOSTNAME})
 Web app:      http://${ct_ip:-<container-ip>}:${WEB_PORT}/voyage_manager.html
 Sync API:     http://${ct_ip:-<container-ip>}:${WEB_PORT}/api/health
 API token:    ${SYNC_TOKEN}

 Credentials saved to: ${creds_file}

 Manage container:
   pct enter ${ctid}
   pct stop ${ctid} && pct start ${ctid}
   pct destroy ${ctid}   # removes container (data lost)

 Cloudflare Tunnel (run on Proxmox host or inside CT):
   pct exec ${ctid} -- bash -c 'curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare.gpg; apt-get install -y cloudflared; cloudflared tunnel --url http://127.0.0.1:${WEB_PORT}'

 Reinstall app only (inside running CT):
   pct exec ${ctid} -- env VOYAGE_IN_CONTAINER=1 VOYAGE_SYNC_TOKEN='${SYNC_TOKEN}' bash -c "curl -fsSL '${SCRIPT_URL}' | bash"

 Update to latest main (from Proxmox host):
   curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | bash

 Update inside CT only:
   pct exec ${ctid} -- bash -c "curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | VOYAGE_IN_CONTAINER=1 bash"

================================================================================
EOF
}

main(){
  if is_inside_lxc; then
    install_in_container
  elif is_proxmox_host; then
    provision_lxc_on_proxmox
  else
    die "This installer must run on a Proxmox VE host (creates a new LXC). If you are already inside a container, set VOYAGE_IN_CONTAINER=1."
  fi
}

main "$@"

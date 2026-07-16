#!/usr/bin/env bash
# Noon Report / Voyage Manager — Proxmox LXC installer
# One-liner: curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-install.sh | sudo bash
set -euo pipefail

REPO_URL="${VOYAGE_REPO_URL:-https://github.com/tsogs66/voyage-manager.git}"
INSTALL_DIR="${VOYAGE_INSTALL_DIR:-/opt/voyage-manager}"
WEB_PORT="${VOYAGE_WEB_PORT:-8080}"
SYNC_PORT="${VOYAGE_SYNC_PORT:-8787}"
SYNC_TOKEN="${VOYAGE_SYNC_TOKEN:-}"
WEB_USER="${VOYAGE_WEB_USER:-www-data}"
BRANCH="${VOYAGE_BRANCH:-main}"

log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: curl ... | sudo bash"

if [[ -z "$SYNC_TOKEN" ]]; then
  SYNC_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  log "Generated SYNC_API_TOKEN (save this): $SYNC_TOKEN"
fi

export DEBIAN_FRONTEND=noninteractive
log "Installing packages..."
apt-get update -qq
apt-get install -y -qq git python3 nginx openssl ca-certificates

log "Cloning repository to $INSTALL_DIR..."
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

log "Configuring nginx static site on port $WEB_PORT..."
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

log "Creating sync server systemd service..."
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
mkdir -p "${INSTALL_DIR}/sync-server/sync-data"
chmod 750 "${INSTALL_DIR}/sync-server/sync-data"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

cat <<EOF

================================================================================
 Noon Report installed successfully
================================================================================

 Web app:      http://${IP:-localhost}:${WEB_PORT}/voyage_manager.html
 Sync API:     http://${IP:-localhost}:${WEB_PORT}/api/health
               (proxied to sync server on port ${SYNC_PORT})

 API token:    ${SYNC_TOKEN}

 In the app (Data tab → Server Sync):
   Sync Server URL:  http://${IP:-localhost}:${WEB_PORT}
                     (or your Cloudflare Tunnel URL)
   API Token:        ${SYNC_TOKEN}

 Cloudflare Tunnel (optional, on this host):
   cloudflared tunnel --url http://127.0.0.1:${WEB_PORT}

 Proxmox LXC quick create (run on Proxmox host, not inside container):
   pct create 120 local:vztmpl/debian-12-standard_12.0-1_amd64.tar.zst \\
     --hostname voyage-manager --memory 1024 --cores 1 --rootfs local-lvm:8 \\
     --net0 name=eth0,bridge=vmbr0,ip=dhcp --unprivileged 1
   pct start 120
   pct enter 120
   curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-install.sh | bash

 Update later:
   sudo VOYAGE_SYNC_TOKEN='${SYNC_TOKEN}' bash ${INSTALL_DIR}/install/proxmox-install.sh

================================================================================
EOF

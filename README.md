# Voyage Manager — Noon Report

Offline-capable ship performance and fuel logging app for engine department noon reports. Tracks fuel consumption, RPM, speed, slip, ROB, lube oil, and supplementary machinery readings.

Works on **Android phones** and **PC browsers** as a Progressive Web App (PWA), with optional sync to a **self-hosted Linux server** behind Cloudflare Tunnel.

## Features

- **Offline-first**: all voyage data stored in IndexedDB — works without internet on Android and PC
- **PWA install**: add to home screen (requires HTTPS or localhost); optional persistent storage
- **Fuel & performance**: flowmeter-based consumption, cubic power law (%MCR/kW), engine vs ship distance, slip
- **SFOC monitoring**: actual vs reference (g/kWh) with 85%/100% curve calibration and optional LCV ISO correction
- **CII / CO₂ estimate**: voyage-level attained CII from IMO Cf factors × fuel × DWT × distance
- **Weather & sea state**: Beaufort wind, Douglas sea state, swell, air/sea temp on Voyage Summary
- **Server sync**: push/pull JSON snapshots per vessel + voyage; merge by record id; delete tombstones; multi-device
- **Export/import**: JSON backup and CSV exports
- **Multi-vessel**: keep several ships in one browser and sync each by vessel slug

## Proxmox install (one-liner)

Run **on the Proxmox VE host** as root. The script **creates a new LXC container**, starts it, and installs the app inside automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-install.sh | bash
```

When finished, it prints the container IP, web URL, and API token. Credentials are also saved to `/root/voyage-manager-ct<ID>.env` on the Proxmox host.

### Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VOYAGE_CTID` | next free ID | Container ID (e.g. `120`) |
| `VOYAGE_HOSTNAME` | `voyage-manager` | LXC hostname |
| `VOYAGE_MEMORY` | `1024` | RAM in MB |
| `VOYAGE_CORES` | `1` | CPU cores |
| `VOYAGE_DISK_GB` | `8` | Root disk size (GB) |
| `VOYAGE_STORAGE` | `local-lvm` | Proxmox storage for rootfs |
| `VOYAGE_BRIDGE` | `vmbr0` | Network bridge |
| `VOYAGE_SYNC_TOKEN` | auto-generated | Sync API bearer token |
| `VOYAGE_TEMPLATE_MATCH` | `debian-12-standard` | OS template name filter |

Example — custom CT ID and token:

```bash
curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-install.sh | \
  VOYAGE_CTID=120 VOYAGE_SYNC_TOKEN='my-secret-token' bash
```

### Reinstall app inside an existing container

```bash
pct exec 120 -- env VOYAGE_IN_CONTAINER=1 bash -c \
  "curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-install.sh | bash"
```

### Update to latest `main` (pull from GitHub)

Run **on the Proxmox host** — finds the container automatically from `/root/voyage-manager-ct*.env`:

```bash
curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | bash
```

With an explicit container ID:

```bash
VOYAGE_CTID=120 curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | bash
```

Or **inside the LXC** (after `pct enter <CTID>`):

```bash
curl -fsSL https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/proxmox-update.sh | VOYAGE_IN_CONTAINER=1 bash
```

The update script `git pull`s `main`, reloads nginx, and restarts the sync service. Your sync data and API token are left unchanged.

| Variable | Default | Description |
|----------|---------|-------------|
| `VOYAGE_CTID` | from creds file | Container to update (Proxmox host only) |
| `VOYAGE_BRANCH` | `main` | Git branch to pull |
| `VOYAGE_INSTALL_DIR` | `/opt/voyage-manager` | App install path |

### Cloudflare Tunnel (optional)

After install, expose the container through Cloudflare:

```bash
pct exec <CTID> -- cloudflared tunnel --url http://127.0.0.1:8080
```

Use the tunnel URL in the app **Data → Server Sync** settings.

## Android Studio app

Native Android wrapper (Capacitor) lives in `android/`. Full steps: [`android/README.md`](android/README.md).

```bash
npm install
npm run cap:sync
npx cap open android
```

Or build from CLI after sync:

```bash
cd android && ./gradlew assembleDebug
```

## Quick Start (Local / Ship PC)

Serve the folder over HTTP (required for PWA and service worker — `file://` URLs will not register a service worker):

```bash
cd /path/to/voyage-manager
python3 -m http.server 8080
```

Open `http://localhost:8080/voyage_manager.html` in Chrome or Edge.

On Android (same Wi‑Fi): `http://<your-pc-ip>:8080/voyage_manager.html` → menu → **Install app** or **Add to Home screen**.

## Formula Reference

| Metric | Formula |
|--------|---------|
| Engine speed (kn) | `RPM × pitch(m) × 60 / 1852` |
| Engine distance (nm) | **Preferred:** `pitch(m) × Δrevs / 1852` · Fallback: `RPM × pitch × 60 / 1852 × hours` |
| Avg RPM from counter | `Δrevs / (hours × 60)` |
| Ship speed (kn) | `distance run (nm) / hours` |
| Slip (%) | `(engine distance − ship distance) / engine distance × 100` |
| %MCR / kW | `(RPM / MCR RPM)³ × 100` and `(RPM / MCR RPM)³ × MCR kW` |
| Fuel (MT) | `litres × specific gravity / 1000` |
| Actual SFOC (g/kWh) | `M/E fuel (g) / (estimated kW × hours)` |
| ISO-corrected SFOC | `SFOC_meas × (LCV_ref / LCV_actual)` · default LCV_ref = 42 700 kJ/kg |
| Reference SFOC | `SFOC₁₀₀ × (a + b × (L/100)²)` calibrated through your 85% and 100% MCR points |
| Attained CII (voyage) | `Σ(fuel_MT × Cf) × 1e6 / (DWT × distance_nm)` · Cf: HFO 3.114, LSFO 3.151, MDO/LSMGO 3.206 |

1 nautical mile = **1852 m** (IHO). Some older references use ~1800 m or 1853 — this app uses the standard 1852.

## Self-Hosted Sync Server

A minimal Python sync server stores voyage snapshots as JSON files.

### Run on Linux

```bash
cd sync-server
export SYNC_API_TOKEN="your-secret-token"
export SYNC_PORT=8787
# Optional: serve the PWA from the same process (handy behind one Cloudflare Tunnel)
export SYNC_STATIC_DIR="$(dirname "$PWD")"
python3 server.py
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNC_API_TOKEN` | `change-me-in-production` | Bearer token for API auth |
| `SYNC_PORT` | `8787` | Listen port |
| `SYNC_HOST` | `0.0.0.0` | Bind address |
| `SYNC_DATA_DIR` | `./sync-data` | JSON storage directory |
| `SYNC_ALLOWED_ORIGINS` | `*` | CORS origins (comma-separated) |
| `SYNC_STATIC_DIR` | unset | If set, also serves `voyage_manager.html` and assets |

API:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check |
| GET | `/api/voyage/<vessel>` | List voyage snapshots for a vessel |
| GET | `/api/voyage/<vessel>/<voyage>` | Pull snapshot |
| PUT | `/api/voyage/<vessel>/<voyage>` | Push / merge snapshot |

### Cloudflare Tunnel

```bash
# On your Linux server (sync only, or sync+static on same port)
cloudflared tunnel --url http://localhost:8787
```

Use the generated `https://….trycloudflare.com` or your custom domain in the app's **Data → Sync Server URL**.

### Configure the App

1. Open **Data** tab
2. Set **Sync Server URL** (e.g. `https://sync.yourdomain.com`)
3. Set **API Token** (same as `SYNC_API_TOKEN`)
4. Set **Vessel ID** (short slug, e.g. `captain-veniamis`)
5. Optionally set a **Device name** (ER tablet / Chief PC) so multi-device merges are identifiable
6. Click **Save Sync Settings**, then **Test Connection**
7. Use **Sync Now**, **List Remote Voyages**, or rely on auto-sync when online

Sync merges records by `id`, keeping the newest `updatedAt` per entry/receipt/document. Deletes propagate via tombstones so a second device does not resurrect removed rows.

## Files

| File | Purpose |
|------|---------|
| `voyage_manager.html` | Main application (single-file SPA) |
| `manifest.webmanifest` | PWA manifest |
| `sw.js` | Service worker for offline caching |
| `icons/` | App icons |
| `sync-server/server.py` | Self-hosted sync API |
| `noonreport_backup.json` | Sample backup data |

## Data Tab

- **Export Full Backup** — portable JSON for another device/browser
- **Import Backup** — restore or migrate data
- **Export Setup Only** — vessel template without log entries

## Notes

- IndexedDB is per-browser; use Export or Sync to move data between devices
- PDF documents are stored as base64 in IndexedDB — large files may be slow to sync
- For production, always set a strong `SYNC_API_TOKEN` and restrict CORS origins

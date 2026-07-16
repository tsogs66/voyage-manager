# Voyage Manager — Noon Report

Offline-capable ship performance and fuel logging app for engine department noon reports. Tracks fuel consumption, RPM, speed, slip, ROB, lube oil, and supplementary machinery readings.

Works on **Android phones** and **PC browsers** as a Progressive Web App (PWA), with optional sync to a **self-hosted Linux server** behind Cloudflare Tunnel.

## Features

- **Offline-first**: all voyage data stored in IndexedDB — works without internet
- **PWA install**: add to home screen on Android or desktop (requires HTTPS or localhost)
- **Fuel & performance**: flowmeter-based consumption, cubic power law (%MCR/KW), engine vs ship distance, slip
- **SFOC monitoring**: actual vs reference specific fuel oil consumption (g/kWh) with load-curve interpolation from 85%/100% MCR shop-trial values
- **Server sync**: push/pull JSON snapshots per vessel + voyage when online
- **Export/import**: JSON backup and CSV exports

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
| Engine distance (nm) | `engine speed × hours` |
| Ship speed (kn) | `distance run (nm) / hours` |
| Slip (%) | `(engine distance − ship distance) / engine distance × 100` |
| %MCR / KW | `(RPM / MCR RPM)³ × 100` and `(RPM / MCR RPM)³ × MCR kW` |
| Fuel (MT) | `litres × specific gravity / 1000` |
| Actual SFOC (g/kWh) | `M/E fuel (g) / (estimated kW × hours)` |
| Reference SFOC | `SFOC₁₀₀ × (a + b × (L/100)²)` calibrated through your 85% and 100% MCR points |

## Self-Hosted Sync Server

A minimal Python sync server stores voyage snapshots as JSON files.

### Run on Linux

```bash
cd sync-server
export SYNC_API_TOKEN="your-secret-token"
export SYNC_PORT=8787
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

### Cloudflare Tunnel

```bash
# On your Linux server
cloudflared tunnel --url http://localhost:8787
```

Use the generated `https://….trycloudflare.com` or your custom domain in the app's **Data → Sync Server URL**.

### Configure the App

1. Open **Data** tab
2. Set **Sync Server URL** (e.g. `https://sync.yourdomain.com`)
3. Set **API Token** (same as `SYNC_API_TOKEN`)
4. Set **Vessel ID** (short slug, e.g. `captain-veniamis`)
5. Click **Save Sync Settings**
6. Use **Sync Now** or rely on auto-sync when online

Sync merges records by `id`, keeping the newest `updatedAt` per entry/receipt/document.

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

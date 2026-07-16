# Noon Report — Engine Log (offline-first PWA + optional self-hosted sync)

A single-file web app for the engine department to keep the vessel's **noon
report / voyage log**: fuel & lube consumption, RPM, speed, apparent slip,
%MCR / KW, specific fuel oil consumption (SFOC), ROB gauges, receipts, BDN
documents and printable reports.

It runs **entirely in the browser** and stores everything locally in the
browser's own database (IndexedDB), so it works with **no internet at all**.
It can also be **installed** on an Android phone or a PC (Add to Home
screen / Install app) and, optionally, **synced** between your devices
through **your own self-hosted Linux server** — typically reached from the
ships/anywhere via a **Cloudflare Tunnel** — reconciling automatically
whenever a connection is available.

```
voyage_manager.html      the whole app (open it directly, or serve it)
manifest.webmanifest     PWA manifest (installable app)
sw.js                    service worker (offline caching)
icons/                   app icons (PNG, generated)
server/                  optional zero-dependency sync server + static host
noonreport_backup.json   sample voyage backup you can Import from the Data tab
```

## 1. Just use it (no server, fully offline)

Open `voyage_manager.html` in any modern browser (Chrome, Edge, Safari,
Firefox) on a phone or PC. All data is saved in that browser automatically.
Use **Data → Export Full Backup (JSON)** to move data to another
browser/computer, or **Import Backup** to load it back.

> Opened as a local file (`file://`) the app works offline already, but it
> cannot be *installed* and cannot sync. For install + sync, serve it over
> `http(s)` (next section).

## 2. Self-hosted server (install + multi-device sync)

The server is **zero-dependency** — plain Node.js (v18+), no `npm install`
needed. It does two jobs: serves the app files, and exposes a tiny
`POST /api/sync` endpoint. Data is stored as one JSON file per vessel under
`server/data/` (easy to back up — just copy the folder).

### Run it

```bash
# from the repo root
SYNC_TOKEN="choose-a-long-secret" node server/server.js
# -> http://0.0.0.0:8787
```

Environment variables:

| Var          | Default        | Meaning                                              |
|--------------|----------------|------------------------------------------------------|
| `PORT`       | `8787`         | Port to listen on                                    |
| `SYNC_TOKEN` | *(empty)*      | Shared secret devices must send. **Set this.** If empty, auth is disabled (only OK on a private LAN). |
| `DATA_DIR`   | `server/data`  | Where vessel JSON files are stored                   |
| `STATIC_DIR` | repo root      | Folder the app files are served from                 |

Run it as a service so it restarts automatically, e.g. with **systemd**:

```ini
# /etc/systemd/system/noon-report.service
[Unit]
Description=Noon Report sync server
After=network.target

[Service]
WorkingDirectory=/opt/noon-report
ExecStart=/usr/bin/node server/server.js
Environment=SYNC_TOKEN=choose-a-long-secret
Environment=PORT=8787
Restart=always
User=noon

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now noon-report
```

### Expose it with a Cloudflare Tunnel

A Cloudflare Tunnel gives your box a stable HTTPS hostname without opening
any inbound firewall ports.

```bash
# install cloudflared on the Linux box, then:
cloudflared tunnel login
cloudflared tunnel create noon-report
# map a hostname to the local server:
cloudflared tunnel route dns noon-report noon.yourdomain.com
cloudflared tunnel --url http://localhost:8787 run noon-report
```

Now the app + sync API are available at `https://noon.yourdomain.com`.
(HTTPS is also what lets the PWA be *installed* on phones.)

> Quick throwaway test without a domain:
> `cloudflared tunnel --url http://localhost:8787` prints a temporary
> `*.trycloudflare.com` URL you can use immediately.

## 3. Connect a device

1. On the phone/PC open `https://noon.yourdomain.com/voyage_manager.html`.
2. (Optional) Install it: browser menu → **Install app / Add to Home screen**.
3. Open **Data → Cloud Sync** and enter:
   - **Server URL** — e.g. `https://noon.yourdomain.com`
   - **Vessel ID** — any label shared by all devices for this vessel, e.g. `captain-veniamis`
   - **Access Token** — the same value as the server's `SYNC_TOKEN`
4. Tick **Auto-sync when online**, press **Save Sync Settings**, then
   **Sync Now**. Repeat on every device using the **same Vessel ID**.

### How sync behaves

- **Offline-first:** every change is written locally first, so the app never
  blocks waiting for a network. When online it reconciles automatically (on
  save, on reconnect, and every 60 s).
- **Conflict handling:** last-write-wins **per record** by edit time — the
  newest edit of a given entry across all devices wins.
- **Deletions propagate** via tombstones, including "Create New Voyage" and
  "Import Backup", which archive/replace the whole voyage.
- **What syncs:** log entries, receipts, BDN documents, saved abstracts,
  print history, and the Setup configuration. Sync settings themselves stay
  on the device.

## Key formulas (standard noon-report maritime formulas)

- **Theoretical / engine speed (kn)** = `Pitch(m) × RPM × 60 ÷ 1852`
- **Engine distance (nm)** = `Pitch × RPM × 60 × RunHours ÷ 1852`
- **Apparent slip (%)** = `(EngineDist − ShipDist) ÷ EngineDist × 100`
- **%MCR** = `(RPM ÷ 100%-load RPM)³ × 100`  (propeller law)
- **M/E power (kW)** = `(RPM ÷ 100%-load RPM)³ × 100%-load kW`
- **Fuel consumed (MT)** = `metre-delta(L) × specific gravity ÷ 1000`
- **M/E SFOC (g/kWh)** = `fuel consumed(g) ÷ (power(kW) × run hours)` — the
  energy-weighted voyage figure is compared against the manufacturer's
  reference SFOC (from Setup → Engine Data) on the Summary tab.
- **Fresh water consumed (L)** = `previousROB + produced − presentROB`

## Regenerating icons

```bash
node server/tools/generate-icons.js   # writes icons/*.png
```

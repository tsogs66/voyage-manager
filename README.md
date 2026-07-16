# Voyage Manager — Noon Report / Engine Log

Offline-first noon report app for a ship's engine department: fuel consumption, RPM, speed,
slip, %MCR/kW, SFOC vs shop test, CO₂ emissions, lube oil, fresh water, ROB gauges, bunker
receipts, BDN documents and printable reports.

Everything runs in the browser and is stored in the browser's local database (IndexedDB), so
the app keeps working with **no internet at all**. When internet is available it can sync with
your own self-hosted server, so several devices (engine room PC, cabin laptop, Android phone)
share the same voyage data.

## Files

| File | Purpose |
| --- | --- |
| `voyage_manager.html` | The whole app (single file — can still be opened directly from disk) |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA support: install on Android/PC, full offline caching |
| `server/server.js` | Zero-dependency Node.js sync server + static host |
| `server/noon-report.service` | Example systemd unit |
| `noonreport_backup.json` | Sample voyage backup (importable from the Data tab) |

## Quick start (any PC, no server)

Open `voyage_manager.html` in Chrome/Edge/Firefox. That's it — data persists in that browser.
Use **Data → Export Full Backup** to move data between machines manually.

## Self-hosted server (Linux + Cloudflare Tunnel)

The server does two jobs: it **hosts the app** (so phones can install it as a PWA) and it
**syncs data** between devices.

### 1. Run the server

```bash
# on your Linux box (needs Node.js >= 16, no npm install required)
git clone <this repo> /opt/noon-report
cd /opt/noon-report/server
SYNC_TOKEN=$(openssl rand -hex 24) node server.js        # prints the app URL on port 8088
echo "your token: check the command above"
```

Keep it running with systemd: edit `server/noon-report.service` (set your own `SYNC_TOKEN`),
then:

```bash
sudo cp server/noon-report.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now noon-report
```

Ship data is stored as plain JSON files in `server/data/` — trivial to back up.

### 2. Expose it through Cloudflare Tunnel

```bash
# one-time setup with cloudflared installed and logged in
cloudflared tunnel create noon-report
cloudflared tunnel route dns noon-report noonreport.yourdomain.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: noon-report
credentials-file: /home/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: noonreport.yourdomain.com
    service: http://localhost:8088
  - service: http_status:404
```

```bash
cloudflared tunnel run noon-report        # or: sudo cloudflared service install
```

Cloudflare gives you HTTPS automatically, which the PWA install requires.
Optionally put Cloudflare Access in front of the hostname for an extra login layer.

### 3. Install on Android phone / PC

1. Open `https://noonreport.yourdomain.com` in Chrome (needs internet once).
2. Chrome offers **Add to Home screen / Install app** — accept. The service worker caches the
   whole app, so it opens and works fully offline from then on.
3. In the app go to **Sync** tab: the Server URL is pre-filled with the site you installed
   from; paste the API Token, choose a Ship ID (same value on every device of the vessel),
   set Auto Sync ON and press **Save Sync Settings**, then **Sync Now**.

Now you can log entries offline at sea; whenever the device gets internet, changes are pushed
and other devices pull them automatically (newest change per record wins, deletions included).

## Sync API (for integrations)

- `POST /api/health` — reachability check. Header `Authorization: Bearer <token>`.
- `POST /api/sync` — body `{shipId, sinceRev, records:[{store,id,updatedAt,deleted,data}]}`;
  responds `{rev, accepted, records:[...]}` with everything changed since `sinceRev`.

## Calculations used

- Speed by engine (kn) = RPM × pitch (m) × 60 ÷ 1852
- Slip % = (engine distance − ship distance) ÷ engine distance × 100
- %MCR = (RPM ÷ MCR RPM)³ × 100, estimated kW = %MCR × MCR kW
- Consumption (MT) = flowmeter litres × specific gravity ÷ 1000 (rollover-safe deltas)
- Actual SFOC (g/kWh) = M/E fuel (g) ÷ (est. kW × running hours), compared against the shop
  test SFOC interpolated between the 85% and 100% load points
- CO₂ (MT) = fuel MT × IMO factor (HFO/LSFO 3.114, MDO/MGO/LSMGO 3.206)
- Fresh water consumed = previous ROB + produced (flowmeter delta) − present ROB

# Voyage Manager — Noon Report

Offline-capable ship performance and fuel logging app for engine department noon reports. Tracks fuel consumption, RPM, speed, slip, ROB, lube oil, and supplementary machinery readings.

Works on **Android phones** and **PC browsers** as a Progressive Web App (PWA), with optional sync to a **self-hosted Linux server** behind Cloudflare Tunnel.

## Signing in at sea

**The fleet manager creates the account, and the engineer must sign in online once
before that device works offline.** That first sign-in is what fetches his vessel and
his data; from then on the same laptop signs in with no connectivity at all.

There is deliberately **no way to provision a device that has never authenticated** —
no credential file to export, carry on a stick, or leak. A laptop earns offline access
by proving itself against the live server, once.

On that first sign-in the app fetches an offline bundle for the ship
(`GET /api/vessel/offline-bundle`) and keeps it. The bundle holds the vessel, its sync
token, and a PBKDF2-HMAC-SHA256 **verifier** for each engineer posted to that ship —
never a password. Offline, the app recomputes the verifier with WebCrypto and compares.
`tests/test_offline_verifier.js` checks the browser's digest against one Python
produced, because if those two disagree by a byte then offline sign-in fails for
everyone and a test of either side alone would not notice.

The bundle is refreshed on every successful online sign-in, so a device that works
today still works after it sails, and a transfer reaches it the next time it connects.

Three rules keep the exposure bounded:

- **A bare vessel token cannot mint credentials.** The token already grants sync;
  issuing offline credentials requires a signed-in session, or the token alone would
  unlock a laptop.
- **Only engineers currently posted to that ship are included**, and fleet manager
  accounts never are — office credentials have no business on a ship's laptop.
- **The bundle expires.** Past that, the device must reach the server again.

The offline path is narrow by design: it is used **only when the server cannot be
reached at all**. If the server answers — including a 401 — its answer stands, so a
revoked login cannot be resurrected by pulling the network cable.

What remains true of any offline scheme: a stolen laptop carries crackable password
material for whoever signed in on it, and a transferred engineer keeps working on the
old device until it reconnects. He cannot *sync* the old ship — assignment is checked
server-side — but he can read what is on that machine. Prefer generated passwords for
chief engineer accounts.

## Bunkering and R.O.B. corrections

R.O.B. is a chain: every report's opening figure is the previous report's closing
figure. Two things break that chain, and both are handled.

**Bunkers received** are logged as receipts — date, grade, tank, quantity, BDN
number, supplier, port, and optionally density, LCV and viscosity. A receipt dated
on or before a report is added to that report's R.O.B., so the delivery flows into
the next report automatically and stays on file as the record of what was taken.

**A bunker survey** corrects the book figure to what the tanks actually sound. It
works either way round: after bunkering, to check the delivery against the tanks —
the panel's Received column shows what landed that day, so a negative difference is
a short delivery, while the receipt stays on file at the BDN quantity for the claim
— or on its own, as a plain survey of the tanks with no bunkering involved.
Record it against the report it was taken with, in Voyage Summary → Bunker Survey /
R.O.B. Correction. From that report onward R.O.B. counts from the **measured**
figure, plus anything bunkered after it, less what has been burnt since — so the
book and the tank reconverge instead of carrying the difference for the rest of the
voyage. The survey stores the calculated figure and the difference beside the
measurement, so the correction is auditable rather than a silent rewrite.

Two rules worth knowing:

- **Bunkers delivered up to the survey day are already inside the measured figure**
  and are not added again, because the survey is taken after bunkering. Bunkers
  received after it are added on top.
- **A tank the surveyor did not sound** falls back to what the book said at the
  moment of the survey, not to the voyage-opening figure — consumption is counted
  only from the survey, so the opening figure has to be the survey's too.

Tank soundings recorded in the Soundings table are still for handover only and do
not touch R.O.B.; the survey panel is the one that corrects it.

## Features

- **Offline-first**: all voyage data stored in IndexedDB — works without internet on Android and PC
- **PWA install**: add to home screen (requires HTTPS or localhost); optional persistent storage
- **Fuel & performance**: flowmeter-based consumption, cubic power law (%MCR/kW), engine vs ship distance, slip
- **SFOC monitoring**: actual vs reference (g/kWh) with 85%/100% curve calibration and optional LCV ISO correction
- **CII / CO₂ estimate**: voyage-level attained CII from IMO Cf factors × fuel × DWT × distance
- **Weather & sea state**: Beaufort wind, Douglas sea state, swell, air/sea temp on Voyage Summary
- **Server sync**: push/pull JSON snapshots per vessel + voyage; merge by record id; delete tombstones; multi-device
- **Export/import**: JSON backup and CSV exports
- **Central vessel database**: per-vessel logins and an admin account on the sync server; tokens derived from vessel name + IMO
- **One vessel per login**: the account decides which ship the program loads

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
| `VOYAGE_SYNC_TOKEN` | auto-generated | Sync API bearer token. Any characters are safe — spaces, `%`, quotes and backslashes are escaped into the systemd unit. The installer verifies the token reached the running server before it reports success. |
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

Use the tunnel URL in the app **Setup → Server Sync** settings.

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

## PC install (one-click, runs locally)

Installs the app onto the PC and always opens it as **local** `http://127.0.0.1` (not the online site). Voyage data stays in that PC’s browser. Updates replace app files only — same local workflow every time.

### One-click (Windows PowerShell)

Copy/paste in PowerShell:

```powershell
$f="$env:TEMP\noon-install-pc.ps1"; iwr https://raw.githubusercontent.com/tsogs66/voyage-manager/main/install/pc/install-pc.ps1 -UseBasicParsing -OutFile $f; powershell -NoProfile -ExecutionPolicy Bypass -File $f
```

This downloads the latest `main` build into `%LOCALAPPDATA%\NoonReport`, creates a **Desktop → Noon Report** shortcut, and starts the app.

- **Start later:** double-click the Desktop shortcut  
- **Update later:** `%LOCALAPPDATA%\NoonReport\bin\Update-NoonReport.bat` (or re-run the one-click command)

### Portable ZIP (no install)

```bash
./scripts/build-pc-portable.sh
```

Share `dist/NoonReport-PC.zip`. On the ship PC: unzip → double-click **Start Noon Report.bat**.

Details: [`install/pc/README.txt`](install/pc/README.txt).

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
| `SYNC_ADMIN_USER` | `admin` | Username of the first administrator |
| `SYNC_ADMIN_PASSWORD` | generated | Password for the first administrator, printed once at startup if generated |
| `SYNC_ACCOUNTS_DB` | `<data>/accounts.db` | SQLite file holding logins, vessels and sessions |
| `SYNC_API_TOKEN` | `change-me-in-production` | Bearer token for API auth. Left unset, the server has no secret to check and accepts **every** request — `/api/health` then reports `"tokenConfigured": false` and the app warns on Test Connection. |
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

Use the generated `https://….trycloudflare.com` or your custom domain in the app's **Setup → Sync Server URL**.

### Configure the App

1. Open **Setup** tab
2. Set **Sync Server URL** (e.g. `https://sync.yourdomain.com`)
3. Set **API Token** (same as `SYNC_API_TOKEN`)
4. Set **Vessel ID** (short slug, e.g. `captain-veniamis`)
5. Optionally set a **Device name** (ER tablet / Chief PC) so multi-device merges are identifiable
6. Click **Save Sync Settings**, then **Test Connection**
7. Use **Sync Now**, **List Remote Voyages**, or rely on auto-sync when online

Sync merges records by `id`, keeping the newest `updatedAt` per entry/receipt/document. Deletes propagate via tombstones so a second device does not resurrect removed rows.


## Central Vessel Database & Login

The sync server holds every login and every vessel. Signing in both authenticates
the user and decides which **single** vessel this copy of the program loads.

### Roles

| Role | Reads | Writes | Manages |
|------|-------|--------|---------|
| `fleet_manager` | Every vessel | Every vessel | Vessels, logins, assignments, transfers |
| `chief_engineer` | Every ship he has **ever** been assigned to | Only the ship he is assigned to **right now** | Nothing |

### Assignments are periods, not fields

```
assignments(username, vessel_id, assigned_at, released_at, assigned_by, note)
```

A posting is a row with `released_at` empty. Re-posting an engineer closes the old
row and opens a new one in the same transaction, so an engineer is never on two
ships or none. One partial unique index enforces a single live posting each.

That single shape gives three things at once:

- **Transfer** — one `POST /api/admin/assign` moves an engineer; the app follows on
  his next login.
- **Service history** — every ship he sailed, and when, for him and for the vessel.
- **The access rule** — a relieved engineer keeps the records he sailed but can no
  longer change them, while his relief inherits the full prior log. That matters
  here: opening ROB and meter readings carry over from the last entry, so a new
  chief engineer joining a ship with no history cannot start a voyage correctly.

### Two ways an engineer gets a ship

The fleet manager creates the account, and either:

- **names a vessel** — `POST /api/admin/accounts` with a `vesselId` posts him to it,
  and he is on that ship the moment he signs in; or
- **leaves it empty** — the account is created with no vessel. He signs in, lands in
  Setup with the vessel fields open, enters the ship he actually joined and presses
  **Register Vessel**.

**The password is generated, not chosen.** `POST /api/admin/accounts` and
`POST /api/admin/vessels` ignore any password in the request and generate one for a
chief engineer, returning the plaintext once in that response — it is stored nowhere
else. Four groups of four from a 31-character alphabet with no `i`, `l`, `o`, `0` or
`1`, so it survives being read off a handover sheet and typed on a ship's laptop:

```
dktn-us5x-4x87-bjjb
```

That is roughly 79 bits. It matters because these credentials end up on a device that
signs in offline, where an attacker who steals the laptop can grind at leisure — the
one thing that must not happen is a weak password picked for convenience by the
office. Fleet manager accounts still take a chosen password.

Vessel identity is the manager's record, but only once there *is* a record. The name,
IMO and company fields stay editable for an engineer who has no vessel yet, or whose
vessel is still pending review, and lock as soon as he is on an established ship — so
he can enter the ship he joined but can never rename someone else's.

### Importing a vessel that is not in the database

`POST /api/vessels/import` with the vessel name, IMO and company:

- **Fleet manager** — registers it, or updates an existing registration.
- **Chief engineer** — may register a ship that is **not yet listed** (this is how a
  device holding local records for an unlisted vessel gets it into the fleet) and is
  posted to it immediately. The vessel is flagged `pendingReview` so the manager can
  see it arrived from a ship rather than the office. Those ships are listed at
  `GET /api/admin/vessels/pending` and called out on the manager's vessel picker at
  sign-in — with the IMO and who registered them — and cleared with
  `POST /api/admin/vessels/approve`.
- Neither path lets an engineer overwrite an existing registration — that returns
  `409 already_registered`. Vessel name, IMO and company are the manager's record,
  and the app makes those fields read-only for anyone else.

### Sample fleet

The four scenario vessels built into the app double as the sample data:

```bash
python3 sync-server/seed_demo_fleet.py --db /opt/voyage-manager/sync-server/sync-data/accounts.db
```

| Vessel | IMO | Slug | Chief engineer |
|--------|-----|------|----------------|
| M/V HARBOUR KEY | 9722101 | `mv-harbour-key` | `aruiz` |
| M/V ROADSTEAD | 9684412 | `mv-roadstead` | `hberg` |
| M/V CIRCUMNAV | 9810024 | `mv-circumnav` | `pnair` |
| M/V PACIFIC TRADER | 9756231 | `mv-pacific-trader` | `mdalisay` |

Slugs match the app's Test Fleet, so the seeded database and the local demo data
line up and can actually sync. Passwords are printed once.

The first administrator is created on first start. Set `SYNC_ADMIN_PASSWORD` to
choose the password, or let the server generate one — it is printed once, at
startup, and only its hash is stored.

### Vessel tokens are derived, not random

A vessel's sync token is `HMAC-SHA256(server secret, VESSEL NAME | IMO)`. The same
name and IMO always regenerate the same token on the same server, so a ship that
loses its token gets it back by typing its name and IMO again — no reset, no
re-issue. Name matching ignores case and extra spaces; `IMO 9722101`, `imo9722101`
and `9722101` are the same ship.

The secret lives in the account database, so tokens survive a restart but cannot
be recomputed by anyone without that file.

### Registering a vessel (admin)

```bash
# Log in
SESSION=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' \
  https://sync.example.com/api/auth/login | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessionToken"])')

# What token would this ship get? (key generator — creates nothing)
curl -s -X POST -H "X-Session-Token: $SESSION" -H 'Content-Type: application/json' \
  -d '{"vesselName":"M/V Fangcheng","imo":"IMO 9722101"}' \
  https://sync.example.com/api/admin/token-preview

# Register it, with a login for the crew
curl -s -X POST -H "X-Session-Token: $SESSION" -H 'Content-Type: application/json' \
  -d '{"vesselName":"M/V Fangcheng","imo":"IMO 9722101","company":"Pacific Ocean Shipping",
       "username":"fangcheng","password":"..."}' \
  https://sync.example.com/api/admin/vessels
```

### In the app

On first launch the program shows a login screen. After signing in:

- **Vessel account** — its ship loads immediately, with the company name and IMO
  from the database, and sync is pointed at that vessel using its own token.
- **Administrator** — pick one vessel from the fleet to load.
- **A token instead of an account** — paste the vessel token to verify it against
  the database and adopt whatever ship it names.
- **No token** — continue with a blank program and no vessel assignment; add a
  vessel later from Setup → Account & Vessel Assignment.

The session is cached locally, so a later boot at sea with no connectivity keeps
its vessel assignment instead of locking the crew out of their own records.

### Auth API

| Endpoint | Who | Purpose |
|----------|-----|---------|
| `POST /api/auth/login` | anyone | Returns a session token, role, and the vessel (with its sync token) |
| `POST /api/auth/logout` | session | Ends the session |
| `GET /api/auth/me` | session or vessel token | Who am I, and which vessel |
| `POST /api/auth/password` | session | Change own password |
| `GET/POST /api/admin/vessels` | admin | List / register vessels |
| `DELETE /api/admin/vessels/<id>` | admin | Remove a vessel and its accounts |
| `POST /api/admin/token-preview` | manager | Token for a name + IMO, without creating anything |
| `GET/POST /api/admin/accounts` | manager | List / create logins |
| `POST /api/admin/assign` | manager | Post an engineer to a ship (this is also the transfer) |
| `POST /api/admin/release` | manager | Sign an engineer off without re-posting |
| `GET /api/admin/crew/<vesselId>` | manager | Who is on a ship now, and who has been |
| `GET /api/assignments/<username>` | own record, or manager | Service history |
| `POST /api/vessels/import` | any login | Register a vessel absent from the database |
| `GET /api/admin/vessels/pending` | manager | Ships registered from a device, awaiting review |
| `GET /api/vessel/offline-bundle` | signed-in user | Earn/refresh this device's offline credentials |
| `POST /api/admin/vessels/approve` | manager | Clear a ship's pending flag |

Data routes are scoped: a vessel login reaching another ship gets `403 wrong_vessel`.
The legacy shared `SYNC_API_TOKEN` still works and still reaches every vessel, so
existing single-token installs keep working untouched.

## Files

| File | Purpose |
|------|---------|
| `voyage_manager.html` | Main application (single-file SPA) |
| `manifest.webmanifest` | PWA manifest |
| `sw.js` | Service worker for offline caching |
| `icons/` | App icons |
| `sync-server/server.py` | Self-hosted sync API |
| `noonreport_backup.json` | Sample backup data |
| `tests/` | Checks run by CI (see below) |

## Checks

```bash
npm test
```

Runs on every push and pull request via `.github/workflows/ci.yml`. No dependencies beyond
Node and Python 3 — nothing to install.

| Check | Guards |
|-------|--------|
| `tests/check_js_syntax.js` | Every shipped `.js` file and each inline `<script>` in `voyage_manager.html` parses. There is no build step, so a syntax error otherwise ships silently. |
| `tests/check_assets.js` | `sw.js`'s cache name and precache list still match `androidInstallCacheName` / `androidInstallAssets` in the app, and every precached file exists. A stale cache name leaves phones on the previous build. |
| `tests/test_sync_auth.py` | Starts `sync-server/server.py` with and without `SYNC_API_TOKEN` and asserts who gets in, including the 401 `reason` codes and a non-ASCII token. |
| `tests/browser_*_e2e.js` | Not in CI (no browser there). Run against a live seeded server with `NODE_PATH` pointing at a `playwright-core` install: `APP_BASE=http://127.0.0.1:8860 NODE_PATH=/path/to/node_modules node tests/browser_empty_vessel_e2e.js`. |
| `tests/test_offline_verifier.js` | The offline password verifier across both languages — that the browser's WebCrypto PBKDF2 reproduces Python's digest exactly, including Unicode passwords, and that the comparison rejects near misses. |
| `tests/test_rob_survey.js` | The R.O.B. chain across a bunker survey — that a survey re-bases it, that earlier reports are untouched, that a bunker taken before the survey is not counted twice, and that the later of two surveys wins. |
| `tests/test_accounts.py` | Logins, derived vessel tokens, crew rotation, and the read-history/write-current rule — including that a transferred engineer still reads his old ship but can no longer write to it, and that the legacy shared token still works. |
| `tests/browser_login_e2e.js` | Not in CI (no browser there). Drives the real login UI in Chromium against a live seeded server. Run it after touching the gate. |
| `tests/test_install_quoting.sh` | The installer's token quoting, checked against systemd's own parser via `systemd-analyze`. Unquoted, systemd splits an `Environment=` value on whitespace and reads `%` as a specifier, so a token with a space or a `%` reached the server truncated — leaving it on its default token, rejecting the very token the installer printed. |

CI also runs `shellcheck` over the install scripts, which are piped from `curl` straight
into `bash` as root.

## Setup Tab

- **Server Sync** — sync server URL, token, vessel slug, push/pull
- **Export Full Backup** — portable JSON for another device/browser
- **Import Backup** — restore or migrate data
- **Export Setup Only** — vessel template without log entries (Vessel Data)

## Vessel Data Tab

- Fleet vessel selection, machinery, tanks, capacities, and related vessel configuration

## Notes

- IndexedDB is per-browser; use Export or Sync to move data between devices
- PDF documents are stored as base64 in IndexedDB — large files may be slow to sync
- For production, always set a strong `SYNC_API_TOKEN` and restrict CORS origins

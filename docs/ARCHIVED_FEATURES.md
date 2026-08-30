# Archived features (safekept)

Before the license-email product packaging change, Voyage Chief used fleet
username/password sign-in and a Fleet Office console. That code remains in
`voyage_manager.html` and `sync-server/` so it can be restored.

**Git snapshot:** branch `archive/pre-license-login-1944` (push of `main`
immediately before this work).

## Feature flags (`APP_FEATURES` in `voyage_manager.html`)

| Flag | Default | What it controls |
|------|---------|------------------|
| `accountLogin` | `false` | Login gate (username/password), Sign in / Sign out |
| `fleetOffice` | `false` | Fleet Office panel + “Open Fleet Office” |
| `vesselAssignmentUi` | `false` | Vessel Data → Account & Vessel Assignment |
| `installAndroid` | `false` | Setup → Install on Android / tablet |
| `installPc` | `false` | Setup → Install on PC |
| `serverSync` | `true` | Setup → Server Sync URL (kept) |

Set a flag to `true` and reload to restore that UI. Server `/api/auth/*` and
`/api/admin/*` routes are unchanged.

## Current identity model

1. First start: **email + license key** (`ChengLicense` lock — same format as
   Tank Chief / ChEng AIO; key prefix `VC-…`).
2. Vessels the user adds sync under `data/users/<email-slug>/…` when
   `X-License-Email` is sent (automatic from the license entitlement).
3. Master license (`cheng-admin` / `MA-…`) can open any user folder via
   `X-Act-As-User`.

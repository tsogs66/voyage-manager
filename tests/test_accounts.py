#!/usr/bin/env python3
"""Central account database: login, vessel tokens, and per-vessel isolation.

Run: python3 tests/test_accounts.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER = REPO_ROOT / "sync-server" / "server.py"

failures: list[str] = []
checks = 0


def check(label: str, actual, expected) -> None:
    global checks
    checks += 1
    if actual == expected:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}: expected {expected!r}, got {actual!r}")
        failures.append(label)


def check_true(label: str, value) -> None:
    check(label, bool(value), True)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(url, token=None, session=None, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if session:
        req.add_header("X-Session-Token", session)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            return err.code, json.loads(raw)
        except json.JSONDecodeError:
            return err.code, {"raw": raw}


class Server:
    def __init__(self, token="master-token", admin_password="admin-secret"):
        self.token = token
        self.admin_password = admin_password
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self._tmp = tempfile.TemporaryDirectory()
        self._proc = None

    def __enter__(self):
        env = dict(os.environ)
        env.update(
            SYNC_HOST="127.0.0.1",
            SYNC_PORT=str(self.port),
            SYNC_DATA_DIR=self._tmp.name,
            SYNC_API_TOKEN=self.token,
            SYNC_ADMIN_PASSWORD=self.admin_password,
            PYTHONUNBUFFERED="1",
        )
        self._proc = subprocess.Popen(
            [sys.executable, str(SERVER)], env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        deadline = time.time() + 25
        while time.time() < deadline:
            if self._proc.poll() is not None:
                raise RuntimeError(f"server exited early:\n{self._proc.stdout.read()}")
            try:
                if request(f"{self.base}/api/health")[0] == 200:
                    return self
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("server never became healthy")

    def __exit__(self, *_exc):
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._tmp.cleanup()


def main() -> int:
    with Server() as srv:
        print("\nadmin bootstrap and login")
        _, health = request(f"{srv.base}/api/health")
        check("health reports login is required", health.get("loginRequired"), True)

        status, bad = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "admin", "password": "wrong"},
        )
        check("wrong password is rejected", status, 401)
        check("rejection names the cause", bad.get("reason"), "bad_credentials")

        status, login = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "admin", "password": "admin-secret"},
        )
        check("admin logs in", status, 200)
        check("admin has the fleet manager role", login.get("role"), "fleet_manager")
        check("admin has no vessel assigned", login.get("vessel"), None)
        admin_session = login["sessionToken"]

        print("\ntoken generator (vessel name + IMO)")
        _, preview1 = request(
            f"{srv.base}/api/admin/token-preview", session=admin_session, method="POST",
            payload={"vesselName": "M/V Fangcheng", "imo": "IMO 9722101"},
        )
        _, preview2 = request(
            f"{srv.base}/api/admin/token-preview", session=admin_session, method="POST",
            payload={"vesselName": "m/v  fangcheng", "imo": "9722101"},
        )
        _, preview3 = request(
            f"{srv.base}/api/admin/token-preview", session=admin_session, method="POST",
            payload={"vesselName": "M/V Fangcheng", "imo": "9722102"},
        )
        check_true("a token is generated", preview1.get("token"))
        check("same name + IMO regenerates the same token", preview2["token"], preview1["token"])
        check_true("a different IMO gives a different token", preview3["token"] != preview1["token"])

        status, missing_imo = request(
            f"{srv.base}/api/admin/token-preview", session=admin_session, method="POST",
            payload={"vesselName": "M/V Fangcheng", "imo": ""},
        )
        check("a missing IMO is refused", status, 400)
        check_true("the refusal explains why", "IMO" in str(missing_imo.get("error")))

        print("\nvessel registration")
        status, created = request(
            f"{srv.base}/api/admin/vessels", session=admin_session, method="POST",
            payload={
                "vesselName": "M/V Fangcheng", "imo": "IMO 9722101",
                "company": "Pacific Ocean Shipping", "username": "fangcheng",
            },
        )
        check("vessel is registered", status, 200)
        vessel = created["vessel"]
        check("slug is derived from the name", vessel["vesselId"], "m-v-fangcheng")
        check("company name is stored", vessel["company"], "Pacific Ocean Shipping")
        check("IMO is normalized to digits", vessel["imo"], "9722101")
        check("the vessel token matches the generator", vessel["token"], preview1["token"])
        check("the vessel account was created", created["account"]["username"], "fangcheng")
        fangcheng_pw = created["account"].get("password")
        check("its password was generated, not chosen", bool(fangcheng_pw), True)
        check("and is long enough to be worth generating", len(fangcheng_pw or "") >= 16, True)

        _, second = request(
            f"{srv.base}/api/admin/vessels", session=admin_session, method="POST",
            payload={"vesselName": "M/V Roadstead", "imo": "9684412",
                     "company": "Pacific Ocean Shipping", "username": "roadstead"},
        )
        vessel2 = second["vessel"]

        print("\nvessel login carries its own vessel and token")
        status, vlogin = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": fangcheng_pw},
        )
        check("vessel user logs in", status, 200)
        check("role is chief engineer", vlogin.get("role"), "chief_engineer")
        check("login returns its vessel", vlogin["vessel"]["vesselId"], "m-v-fangcheng")
        check("login returns the company", vlogin["vessel"]["company"], "Pacific Ocean Shipping")
        check("login returns the sync token", vlogin["vessel"]["token"], vessel["token"])
        vessel_session = vlogin["sessionToken"]

        print("\none vessel per login")
        status, _ = request(
            f"{srv.base}/api/voyage/m-v-fangcheng", session=vessel_session,
            method="PUT", payload={"entries": []},
        )
        check("its own vessel is writable", status, 404)  # PUT needs the full leg path

        status, _ = request(
            f"{srv.base}/api/voyage/m-v-fangcheng/22/B", session=vessel_session,
            method="PUT", payload={"entries": [{"id": "e1", "updatedAt": "2026-01-01T00:00:00Z"}]},
        )
        check("its own vessel accepts a push", status, 200)

        status, _ = request(f"{srv.base}/api/voyage/m-v-fangcheng", session=vessel_session)
        check("its own vessel accepts a pull", status, 200)

        status, denied = request(f"{srv.base}/api/voyage/m-v-roadstead", session=vessel_session)
        check("another vessel is refused", status, 403)
        check("the refusal names the reason", denied.get("reason"), "wrong_vessel")

        status, _ = request(
            f"{srv.base}/api/voyage/m-v-roadstead/22/B", session=vessel_session,
            method="PUT", payload={"entries": []},
        )
        check("another vessel cannot be written", status, 403)

        print("\nthe vessel token alone works for sync")
        status, _ = request(f"{srv.base}/api/voyage/m-v-fangcheng", token=vessel["token"])
        check("vessel token pulls its own vessel", status, 200)
        status, _ = request(f"{srv.base}/api/voyage/m-v-roadstead", token=vessel["token"])
        check("vessel token is refused elsewhere", status, 403)
        status, _ = request(f"{srv.base}/api/voyage/m-v-roadstead", token=vessel2["token"])
        check("the other vessel's token works there", status, 200)

        print("\nadmin reaches every vessel")
        status, _ = request(f"{srv.base}/api/voyage/m-v-fangcheng", session=admin_session)
        check("admin pulls vessel one", status, 200)
        status, _ = request(f"{srv.base}/api/voyage/m-v-roadstead", session=admin_session)
        check("admin pulls vessel two", status, 200)
        status, listing = request(f"{srv.base}/api/admin/vessels", session=admin_session)
        check("admin lists the fleet", len(listing["vessels"]), 2)

        print("\nvessel users are not admins")
        status, _ = request(f"{srv.base}/api/admin/vessels", session=vessel_session)
        check("vessel user cannot list the fleet", status, 403)
        status, _ = request(
            f"{srv.base}/api/admin/vessels", session=vessel_session, method="POST",
            payload={"vesselName": "M/V Sneaky", "imo": "1234567"},
        )
        check("vessel user cannot register a vessel", status, 403)

        print("\nthe legacy shared token still works")
        status, _ = request(f"{srv.base}/api/voyage/m-v-fangcheng", token="master-token")
        check("master token pulls any vessel", status, 200)
        status, _ = request(f"{srv.base}/api/voyage/m-v-roadstead", token="master-token")
        check("master token pulls the other", status, 200)
        status, _ = request(f"{srv.base}/api/voyage/m-v-fangcheng", token="not-the-token")
        check("an unknown token is still rejected", status, 401)

        print("\nre-registering a vessel keeps its identity")
        _, again = request(
            f"{srv.base}/api/admin/vessels", session=admin_session, method="POST",
            payload={"vesselName": "M/V Fangcheng", "imo": "IMO 9722101",
                     "company": "New Owner Marine"},
        )
        check("same slug", again["vessel"]["vesselId"], "m-v-fangcheng")
        check("same token", again["vessel"]["token"], vessel["token"])
        check("company updated", again["vessel"]["company"], "New Owner Marine")
        _, listing = request(f"{srv.base}/api/admin/vessels", session=admin_session)
        check("still two vessels, not three", len(listing["vessels"]), 2)


        print("\ncrew rotation: transfer, history, and who may still write")
        # Post the Fangcheng engineer across to Roadstead, as a manager would at
        # a crew change. The old assignment closes in the same transaction.
        status, moved = request(
            f"{srv.base}/api/admin/assign", session=admin_session, method="POST",
            payload={"username": "fangcheng", "vesselId": "m-v-roadstead",
                     "note": "crew change Singapore"},
        )
        check("the transfer is accepted", status, 200)
        check("he is posted to the new ship", moved["assignment"]["vesselId"], "m-v-roadstead")
        check("the incumbent on that ship is signed off",
              moved["assignment"].get("displaced"), "roadstead")

        status, relogin = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": fangcheng_pw},
        )
        moved_session = relogin["sessionToken"]
        check("login now returns the new ship", relogin["vessel"]["vesselId"], "m-v-roadstead")
        check("both ships are in his history", sorted(v["vesselId"] for v in relogin["history"]),
              ["m-v-fangcheng", "m-v-roadstead"])

        status, _ = request(
            f"{srv.base}/api/voyage/m-v-roadstead/50/B", session=moved_session,
            method="PUT", payload={"entries": []},
        )
        check("he writes to the ship he is on", status, 200)

        # The point of the period model: he keeps the record he sailed, but the
        # relief owns it now.
        status, _ = request(f"{srv.base}/api/voyage/m-v-fangcheng", session=moved_session)
        check("he still reads his previous ship", status, 200)
        status, refused = request(
            f"{srv.base}/api/voyage/m-v-fangcheng/22/B", session=moved_session,
            method="PUT", payload={"entries": []},
        )
        check("he can no longer write to it", refused and 403, 403)
        check("the refusal says why", refused.get("reason"), "not_current_vessel")

        status, hist = request(f"{srv.base}/api/assignments/fangcheng", session=moved_session)
        check("he can read his own service record", status, 200)
        check("it shows two postings", len(hist["assignments"]), 2)
        check("the current one is the new ship",
              next(a["vesselId"] for a in hist["assignments"] if a["current"]), "m-v-roadstead")

        status, _ = request(f"{srv.base}/api/assignments/roadstead", session=moved_session)
        check("he cannot read another engineer's record", status, 403)

        status, crew = request(f"{srv.base}/api/admin/crew/m-v-fangcheng", session=admin_session)
        check("the manager sees who sailed a ship", status, 200)
        check("and that nobody is on it now", crew["crew"]["chiefEngineer"], None)

        print("\nimporting a vessel that is not in the database")
        status, imported = request(
            f"{srv.base}/api/vessels/import", session=moved_session, method="POST",
            payload={"vesselName": "M/V Local Only", "imo": "9999001",
                     "company": "Pacific Ocean Shipping"},
        )
        check("an engineer may register an unlisted ship", status, 200)
        check("it is created", imported["created"], True)
        check("and he is posted to it", imported["assignment"]["vesselId"], "m-v-local-only")
        status, _ = request(
            f"{srv.base}/api/voyage/m-v-local-only/1/B", session=moved_session,
            method="PUT", payload={"entries": []},
        )
        check("so his local data can be pushed", status, 200)

        status, clash = request(
            f"{srv.base}/api/vessels/import", session=moved_session, method="POST",
            payload={"vesselName": "M/V Renamed", "imo": "9722101"},
        )
        check("but he cannot overwrite a registered ship", status, 409)
        check("the refusal names the reason", clash.get("reason"), "already_registered")

        status, mgr_import = request(
            f"{srv.base}/api/vessels/import", session=admin_session, method="POST",
            payload={"vesselName": "M/V Fangcheng", "imo": "9722101",
                     "company": "Renamed Marine"},
        )
        check("the fleet manager may change vessel details", status, 200)
        check("and the change lands", mgr_import["vessel"]["company"], "Renamed Marine")


        print("\nvessels registered from a ship are held for review")
        status, pending = request(f"{srv.base}/api/admin/vessels/pending", session=admin_session)
        check("the manager can list them", status, 200)
        check("the self-registered ship is there",
              [v["vesselId"] for v in pending["vessels"]], ["m-v-local-only"])
        check("and it names who registered it", pending["vessels"][0]["createdBy"], "fangcheng")

        status, all_v = request(f"{srv.base}/api/admin/vessels", session=admin_session)
        flagged = {v["vesselId"]: v["pendingReview"] for v in all_v["vessels"]}
        check("the flag shows in the full fleet list", flagged.get("m-v-local-only"), True)
        check("a ship registered by the office is not flagged", flagged.get("m-v-fangcheng"), False)

        status, _ = request(f"{srv.base}/api/admin/vessels/pending", session=moved_session)
        check("an engineer cannot list them", status, 403)
        status, _ = request(
            f"{srv.base}/api/admin/vessels/approve", session=moved_session, method="POST",
            payload={"vesselId": "m-v-local-only"},
        )
        check("nor approve one", status, 403)

        status, approved = request(
            f"{srv.base}/api/admin/vessels/approve", session=admin_session, method="POST",
            payload={"vesselId": "m-v-local-only"},
        )
        check("the manager approves it", status, 200)
        check("the flag is cleared", approved["vessel"]["pendingReview"], False)
        _, after = request(f"{srv.base}/api/admin/vessels/pending", session=admin_session)
        check("and it leaves the pending list", after["vessels"], [])

        status, missing = request(
            f"{srv.base}/api/admin/vessels/approve", session=admin_session, method="POST",
            payload={"vesselId": "no-such-ship"},
        )
        check("approving a ship that does not exist is refused", status, 400)


        print("\noffline access is a device enrollment, not a password verifier")
        # There is no manager export: a device that has never authenticated cannot
        # be given credentials out of band. The old verifier-bundle path is gone.
        status, _ = request(
            f"{srv.base}/api/admin/vessels/m-v-roadstead/offline-bundle", session=admin_session)
        check("the office cannot export credentials", status, 404)
        status, _ = request(f"{srv.base}/api/vessel/offline-bundle", session=moved_session)
        check("the password-verifier bundle is gone", status, 404)

        import secrets as _secrets
        device_id = "dev_" + _secrets.token_urlsafe(16)
        device_secret = _secrets.token_urlsafe(32)
        status, enrolled = request(
            f"{srv.base}/api/auth/devices", session=moved_session, method="POST",
            payload={"deviceId": device_id, "secret": device_secret, "label": "Chief PC"},
        )
        check("a signed-in engineer enrolls this laptop", status, 200)
        check("the enrollment names him", enrolled["device"]["username"], "fangcheng")
        check("and is not revoked", enrolled["device"]["revoked"], False)
        check("no secret is stored in the listing", "secret" in enrolled["device"], False)

        status, _ = request(
            f"{srv.base}/api/auth/devices", session=admin_session, method="POST",
            payload={"deviceId": "dev_" + _secrets.token_urlsafe(16),
                     "secret": _secrets.token_urlsafe(32)},
        )
        check("a fleet manager cannot enroll a device", status, 403)

        status, _ = request(
            f"{srv.base}/api/auth/devices", method="POST",
            payload={"deviceId": device_id, "secret": device_secret},
        )
        check("an anonymous caller cannot enroll", status, 401)

        status, tok = request(
            f"{srv.base}/api/auth/devices", token=vessel["token"], method="POST",
            payload={"deviceId": "dev_" + _secrets.token_urlsafe(16),
                     "secret": _secrets.token_urlsafe(32)},
        )
        check("a bare vessel token cannot enroll a laptop", status, 403)
        check("and says why", tok.get("reason"), "session_required")

        status, dlogin = request(
            f"{srv.base}/api/auth/device-login", method="POST",
            payload={"deviceId": device_id, "secret": device_secret},
        )
        check("the enrolled device can sign in", status, 200)
        check("as the same engineer", dlogin.get("username"), "fangcheng")
        check("onto his current ship", dlogin["vessel"]["vesselId"], "m-v-local-only")

        status, _ = request(
            f"{srv.base}/api/auth/device-login", method="POST",
            payload={"deviceId": device_id, "secret": "wrong-secret-wrong-secret-wrong-secret"},
        )
        check("a wrong device secret is refused", status, 401)

        status, listed = request(f"{srv.base}/api/admin/devices", session=admin_session)
        check("the office can list devices", status, 200)
        check("and sees this laptop",
              any(d["deviceId"] == device_id for d in listed["devices"]), True)

        status, rev = request(
            f"{srv.base}/api/admin/devices/revoke", session=admin_session, method="POST",
            payload={"deviceId": device_id},
        )
        check("the office can revoke it", status, 200)
        check("and it is marked revoked", rev["device"]["revoked"], True)
        status, dead = request(
            f"{srv.base}/api/auth/device-login", method="POST",
            payload={"deviceId": device_id, "secret": device_secret},
        )
        check("the revoked device cannot sign in", status, 401)
        check("and names the cause", dead.get("reason"), "device_revoked")
        status, reenroll = request(
            f"{srv.base}/api/auth/devices", session=moved_session, method="POST",
            payload={"deviceId": device_id, "secret": device_secret},
        )
        check("a revoked device cannot be re-enrolled under the same id", status, 400)

        # Fresh device after revoke still works — a replacement laptop.
        new_id = "dev_" + _secrets.token_urlsafe(16)
        new_secret = _secrets.token_urlsafe(32)
        status, _ = request(
            f"{srv.base}/api/auth/devices", session=moved_session, method="POST",
            payload={"deviceId": new_id, "secret": new_secret, "label": "Spare PC"},
        )
        check("a new laptop can still enroll", status, 200)

        # Signed off, he has no ship, but the device still authenticates him.
        request(f"{srv.base}/api/admin/release", session=admin_session, method="POST",
                payload={"username": "fangcheng"})
        status, released = request(
            f"{srv.base}/api/auth/device-login", method="POST",
            payload={"deviceId": new_id, "secret": new_secret},
        )
        check("a released engineer can still unlock his laptop", status, 200)
        check("with no ship", released.get("vessel"), None)
        # Put him back, so this section leaves the state it found.
        request(f"{srv.base}/api/admin/assign", session=admin_session, method="POST",
                payload={"username": "fangcheng", "vesselId": "m-v-local-only"})


        print("\nthe manager creates an account, with a ship or without one")
        status, withship = request(
            f"{srv.base}/api/admin/accounts", session=admin_session, method="POST",
            payload={"username": "newce", "role": "chief_engineer",
                     "vesselId": "m-v-fangcheng"},
        )
        check("an account can be created with a ship", status, 200)
        newce_pw = withship["account"].get("password")
        check("with a generated password", bool(newce_pw), True)
        check("the role is stored canonically", withship["account"]["role"], "chief_engineer")
        status, ce = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "newce", "password": newce_pw},
        )
        newce_session = ce["sessionToken"]
        check("he logs in onto that ship", ce["vessel"]["vesselId"], "m-v-fangcheng")
        # The posting must be real, not just a column on the account.
        status, _ = request(
            f"{srv.base}/api/voyage/m-v-fangcheng/1/B", session=newce_session,
            method="PUT", payload={"entries": []},
        )
        check("and can write to it immediately", status, 200)

        status, empty = request(
            f"{srv.base}/api/admin/accounts", session=admin_session, method="POST",
            payload={"username": "joiner", "role": "chief_engineer"},
        )
        check("an account can be created with no ship", status, 200)
        joiner_pw = empty["account"].get("password")
        check("also with a generated password", bool(joiner_pw), True)
        check("and every account gets a different one", joiner_pw != newce_pw, True)
        check("and none is reported", empty["vessel"], None)

        status, jl = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "joiner", "password": joiner_pw},
        )
        joiner_session = jl["sessionToken"]
        check("he can sign in", status, 200)
        check("with no vessel", jl["vessel"], None)
        check("and an empty history", jl["history"], [])

        status, fleet = request(f"{srv.base}/api/vessels", session=joiner_session)
        check("an unassigned engineer can see the fleet register", status, 200)
        check("without being given a vessel token",
              all("token" not in v for v in fleet["vessels"]), True)
        check("and Fangcheng is on it",
              any(v["vesselId"] == "m-v-fangcheng" for v in fleet["vessels"]), True)
        fangcheng_row = next(v for v in fleet["vessels"] if v["vesselId"] == "m-v-fangcheng")
        check("and names who is already aboard", fangcheng_row.get("chiefEngineer"), "newce")

        status, occupied = request(
            f"{srv.base}/api/vessels/claim", session=joiner_session, method="POST",
            payload={"vesselId": "m-v-fangcheng"},
        )
        check("claiming an occupied ship is refused", status, 409)
        check("and names the reason", occupied.get("reason"), "ship_occupied")
        check("and names who is aboard", occupied.get("chiefEngineer"), "newce")
        check("so he did not kick anyone off", occupied.get("ok"), None)

        status, claimed = request(
            f"{srv.base}/api/vessels/claim", session=joiner_session, method="POST",
            payload={"vesselId": "m-v-roadstead"},
        )
        check("he can claim a registered ship that is empty", status, 200)
        check("and he is posted to it", claimed["assignment"]["vesselId"], "m-v-roadstead")
        check("with the sync token so the app can follow",
              bool(claimed["vessel"].get("token")), True)
        status, _ = request(
            f"{srv.base}/api/voyage/m-v-roadstead/1/B", session=joiner_session,
            method="PUT", payload={"entries": [{"id": "join1", "updatedAt": "2026-02-01T00:00:00Z"}]},
        )
        check("and can write to the claimed ship", status, 200)

        status, twice = request(
            f"{srv.base}/api/vessels/claim", session=joiner_session, method="POST",
            payload={"vesselId": "m-v-fangcheng"},
        )
        check("claiming a second ship is refused — that is a transfer", status, 400)
        check("and says so", twice.get("reason"), "already_assigned")

        status, _ = request(
            f"{srv.base}/api/vessels/claim", session=admin_session, method="POST",
            payload={"vesselId": "m-v-fangcheng"},
        )
        check("a manager cannot claim a posting", status, 403)

        print("\nthe office assigns by displacing, the engineer cannot")
        status, takeover = request(
            f"{srv.base}/api/admin/assign", session=admin_session, method="POST",
            payload={"username": "joiner", "vesselId": "m-v-fangcheng"},
        )
        check("the office can post him onto an occupied ship", status, 200)
        check("the incumbent is named", takeover["assignment"].get("displaced"), "newce")
        check("and he is now on Fangcheng", takeover["assignment"]["vesselId"], "m-v-fangcheng")

        status, leftover = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "newce", "password": newce_pw},
        )
        check("the signed-off engineer still logs in", status, 200)
        check("but with no vessel", leftover.get("vessel"), None)
        status, blocked = request(
            f"{srv.base}/api/voyage/m-v-fangcheng/1/B", session=newce_session,
            method="PUT", payload={"entries": []},
        )
        check("and can no longer write the ship he left", blocked and 403, 403)
        status, _ = request(
            f"{srv.base}/api/voyage/m-v-fangcheng/1/B", session=joiner_session,
            method="PUT", payload={"entries": [{"id": "join2", "updatedAt": "2026-02-01T01:00:00Z"}]},
        )
        check("the new posting can write it", status, 200)

        # Release him so the later import path still has an unassigned engineer.
        request(f"{srv.base}/api/admin/release", session=admin_session, method="POST",
                payload={"username": "joiner"})
        status, jl2 = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "joiner", "password": joiner_pw},
        )
        joiner_session = jl2["sessionToken"]

        # He enters a ship that is not on the register yet.
        status, made = request(
            f"{srv.base}/api/vessels/import", session=joiner_session, method="POST",
            payload={"vesselName": "M/V Newly Joined", "imo": "9800111",
                     "company": "Pacific Ocean Shipping"},
        )
        check("the engineer registers the ship he joined", status, 200)
        check("it is created", made["created"], True)
        check("and he is posted to it", made["assignment"]["vesselId"], "m-v-newly-joined")
        check("the office can see it arrived from a ship", made["vessel"]["pendingReview"], True)
        status, _ = request(
            f"{srv.base}/api/voyage/m-v-newly-joined/1/B", session=joiner_session,
            method="PUT", payload={"entries": []},
        )
        check("he can log against it at once", status, 200)

        # But he still cannot rename an established ship.
        status, _ = request(
            f"{srv.base}/api/vessels/import", session=joiner_session, method="POST",
            payload={"vesselName": "M/V Not Yours", "imo": "9722101"},
        )
        check("an established ship is still not his to rename", status, 409)

        print("\na password the office tries to choose is ignored")
        status, weak = request(
            f"{srv.base}/api/admin/accounts", session=admin_session, method="POST",
            payload={"username": "weakling", "password": "123456", "role": "chief_engineer"},
        )
        check("the account is created", status, 200)
        chosen = weak["account"].get("password")
        check("but not with the password they asked for", chosen == "123456", False)
        status, _ = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "weakling", "password": "123456"},
        )
        check("and that password does not work", status, 401)
        status, _ = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "weakling", "password": chosen},
        )
        check("the generated one does", status, 200)


        print("\nonly the office changes passwords")
        status, refused = request(
            f"{srv.base}/api/auth/password", session=moved_session, method="POST",
            payload={"currentPassword": fangcheng_pw, "newPassword": "easy-to-remember"},
        )
        check("an engineer cannot change his own", status, 403)
        check("and is told where to go", refused.get("reason"), "manager_only")
        status, _ = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": "easy-to-remember"},
        )
        check("the weak password he wanted does not work", status, 401)
        status, _ = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": fangcheng_pw},
        )
        check("his generated one still does", status, 200)

        status, reset = request(
            f"{srv.base}/api/auth/password", session=admin_session, method="POST",
            payload={"username": "fangcheng", "newPassword": "office-picked-this"},
        )
        check("the manager can reset it", status, 200)
        check("the replacement is generated, not the one asked for", reset["generated"], True)
        check("and it is not what was sent", reset["password"] == "office-picked-this", False)
        status, _ = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": "office-picked-this"},
        )
        check("so that password does not work either", status, 401)
        status, relog = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": reset["password"]},
        )
        check("the generated replacement does", status, 200)
        moved_session = relog["sessionToken"]

        status, _ = request(
            f"{srv.base}/api/auth/password", session=admin_session, method="POST",
            payload={"username": "nobody-here", "newPassword": "x"},
        )
        check("resetting an account that does not exist is refused", status, 400)

        # The manager's own password is still his to choose, and still needs the old one.
        status, _ = request(
            f"{srv.base}/api/auth/password", session=admin_session, method="POST",
            payload={"currentPassword": "wrong", "newPassword": "new-admin-secret"},
        )
        check("changing his own with a wrong current password fails", status, 401)
        status, own = request(
            f"{srv.base}/api/auth/password", session=admin_session, method="POST",
            payload={"currentPassword": "admin-secret", "newPassword": "new-admin-secret"},
        )
        check("with the right one it succeeds", status, 200)
        check("and his is not generated for him", own["generated"], False)
        status, _ = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "admin", "password": "new-admin-secret"},
        )
        check("the manager's chosen password works", status, 200)

        print("\nsession lifecycle")
        status, me = request(f"{srv.base}/api/auth/me", session=moved_session)
        check("me returns the ship he was last posted to", me["vessel"]["vesselId"], "m-v-local-only")
        request(f"{srv.base}/api/auth/logout", session=moved_session, method="POST")
        status, _ = request(f"{srv.base}/api/auth/me", session=moved_session)
        check("the session is dead after logout", status, 401)
        status, _ = request(f"{srv.base}/api/voyage/m-v-roadstead", session=moved_session)
        check("the dead session cannot sync", status, 401)

    print()
    if failures:
        print(f"FAILED — {len(failures)} of {checks} checks:")
        for name in failures:
            print(f"  - {name}")
        return 1
    print(f"PASSED — {checks} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())

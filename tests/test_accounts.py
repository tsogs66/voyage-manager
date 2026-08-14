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
                "password": "vessel-secret",
            },
        )
        check("vessel is registered", status, 200)
        vessel = created["vessel"]
        check("slug is derived from the name", vessel["vesselId"], "m-v-fangcheng")
        check("company name is stored", vessel["company"], "Pacific Ocean Shipping")
        check("IMO is normalized to digits", vessel["imo"], "9722101")
        check("the vessel token matches the generator", vessel["token"], preview1["token"])
        check("the vessel account was created", created["account"]["username"], "fangcheng")

        _, second = request(
            f"{srv.base}/api/admin/vessels", session=admin_session, method="POST",
            payload={"vesselName": "M/V Roadstead", "imo": "9684412",
                     "company": "Pacific Ocean Shipping", "username": "roadstead",
                     "password": "vessel-secret"},
        )
        vessel2 = second["vessel"]

        print("\nvessel login carries its own vessel and token")
        status, vlogin = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": "vessel-secret"},
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

        status, relogin = request(
            f"{srv.base}/api/auth/login", method="POST",
            payload={"username": "fangcheng", "password": "vessel-secret"},
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

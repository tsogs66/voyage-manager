#!/usr/bin/env python3
"""Vessel library list/import across per-email user folders."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SERVER = REPO / "sync-server" / "server.py"

failures: list[str] = []
checks = 0


def check(label: str, actual, expected=None, pred=None) -> None:
    global checks
    checks += 1
    ok = pred(actual) if pred else actual == expected
    if ok:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}: got {actual!r} expected {expected!r}")
        failures.append(label)


def main() -> int:
    td = Path(tempfile.mkdtemp(prefix="vlib-"))
    env = os.environ.copy()
    env["SYNC_DATA_DIR"] = str(td)
    env["SYNC_API_TOKEN"] = "lib-token"
    env.pop("SYNC_ALLOW_OPEN", None)

    # Root vessel with a laden leg
    leg = {
        "voyageNumber": "7",
        "condition": "L",
        "updatedAt": "2026-09-13T08:00:00Z",
        "data": {
            "setup": {"vesselName": "MV LIBRARY", "imoNo": "9999999", "flag": "NO", "chEng": "Chief"},
            "entries": [{"id": "a1", "at": "2026-09-13T06:00:00Z"}],
        },
    }
    root_leg = td / "libship" / "7"
    root_leg.mkdir(parents=True)
    (root_leg / "L.json").write_text(json.dumps(leg), encoding="utf-8")

    # Another user's vessel
    other = {
        "voyageNumber": "3",
        "condition": "B",
        "updatedAt": "2026-09-12T08:00:00Z",
        "data": {"setup": {"vesselName": "MV OTHER", "imoNo": "8888888"}, "entries": []},
    }
    other_leg = td / "users" / "peer-ship-com" / "othership" / "3"
    other_leg.mkdir(parents=True)
    (other_leg / "B.json").write_text(json.dumps(other), encoding="utf-8")

    import importlib.util

    for k in ("SYNC_DATA_DIR", "SYNC_API_TOKEN"):
        os.environ[k] = env[k]
    os.environ.pop("SYNC_ALLOW_OPEN", None)
    spec = importlib.util.spec_from_file_location("vlib_server", SERVER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    lib = mod.list_vessel_library()
    check("lists both vessels", len(lib), 2)
    by_id = {v["vesselId"]: v for v in lib}
    check("root name", by_id["libship"]["name"], "MV LIBRARY")
    check("root imo", by_id["libship"]["imo"], "9999999")
    check("peer owner", by_id["othership"]["ownerSlug"], "peer-ship-com")

    httpd = mod.ThreadingHTTPServer(("127.0.0.1", 0), mod.SyncHandler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    def call(path, method="GET", payload=None, email="me@ship.com"):
        headers = {"Authorization": "Bearer lib-token", "X-License-Email": email}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read().decode())

    st, body = call("/api/vessel-library")
    check("GET library 200", st, 200)
    check("GET has vessels", len(body.get("vessels") or []), 2)

    st, body = call(
        "/api/vessel-library/import",
        "POST",
        {"ownerSlug": None, "vesselId": "libship"},
        email="me@ship.com",
    )
    check("import 200", st, 200)
    check("import has leg", bool(body.get("voyageLeg")), True)
    dest = td / "users" / "me-ship-com" / "libship" / "7" / "L.json"
    check("leg copied into user DB", dest.exists(), True)
    copied = json.loads(dest.read_text(encoding="utf-8"))
    check(
        "copied setup name",
        ((copied.get("data") or {}).get("setup") or {}).get("vesselName"),
        "MV LIBRARY",
    )

    st, body = call(
        "/api/vessel-library/import",
        "POST",
        {"ownerSlug": "peer-ship-com", "vesselId": "othership"},
        email="me@ship.com",
    )
    check("import peer vessel", st, 200)
    check(
        "peer leg in my DB",
        (td / "users" / "me-ship-com" / "othership" / "3" / "B.json").exists(),
        True,
    )

    httpd.shutdown()
    print()
    if failures:
        print(f"FAILED — {len(failures)}/{checks} checks")
        return 1
    print(f"PASSED — {checks} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())

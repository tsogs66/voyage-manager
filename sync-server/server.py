#!/usr/bin/env python3
"""Self-hosted sync server for Noon Report / Voyage Manager.

Stores voyage snapshots as JSON files. Designed to run behind Cloudflare Tunnel
or nginx on a Linux server. Can optionally serve the static PWA files from the
same process (set SYNC_STATIC_DIR to the app root).

API:
  GET  /api/health
  GET  /api/voyage/<vessel>                 — list voyages for a vessel
  GET  /api/voyage/<vessel>/<voyage>        — pull snapshot
  PUT  /api/voyage/<vessel>/<voyage>        — push / merge snapshot

Auth: Authorization: Bearer <SYNC_API_TOKEN>
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

DATA_DIR = Path(os.environ.get("SYNC_DATA_DIR", "./sync-data"))
API_TOKEN = os.environ.get("SYNC_API_TOKEN", "change-me-in-production")
HOST = os.environ.get("SYNC_HOST", "0.0.0.0")
PORT = int(os.environ.get("SYNC_PORT", "8787"))
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("SYNC_ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
]
STATIC_DIR = Path(os.environ["SYNC_STATIC_DIR"]).resolve() if os.environ.get("SYNC_STATIC_DIR") else None

SLUG_RE = re.compile(r"^[a-zA-Z0-9._-]{1,64}$")
LIST_KEYS = ("entries", "receipts", "documents", "abstracts", "printHistory")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_slug(value: str) -> str:
    value = unquote(value or "").strip()
    if not SLUG_RE.match(value):
        raise ValueError("invalid slug")
    return value


def voyage_path(vessel: str, voyage: str) -> Path:
    vessel = safe_slug(vessel)
    voyage = safe_slug(voyage)
    return DATA_DIR / vessel / f"{voyage}.json"


def vessel_dir(vessel: str) -> Path:
    return DATA_DIR / safe_slug(vessel)


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    send_cors(handler)
    handler.end_headers()
    handler.wfile.write(body)


def send_cors(handler: BaseHTTPRequestHandler) -> None:
    origin = handler.headers.get("Origin", "")
    if "*" in ALLOWED_ORIGINS:
        handler.send_header("Access-Control-Allow-Origin", "*")
    elif origin in ALLOWED_ORIGINS:
        handler.send_header("Access-Control-Allow-Origin", origin)
    handler.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, If-None-Match, X-Device-Id, X-Device-Name",
    )
    handler.send_header("Access-Control-Expose-Headers", "ETag")
    handler.send_header("Access-Control-Max-Age", "86400")


def list_voyages(vessel: str) -> list[dict]:
    root = vessel_dir(vessel)
    if not root.exists():
        return []
    out: list[dict] = []
    for path in sorted(root.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        out.append(
            {
                "voyageKey": data.get("voyageKey") or path.stem,
                "updatedAt": data.get("updatedAt") or data.get("serverUpdatedAt"),
                "deviceId": data.get("deviceId"),
                "deviceName": data.get("deviceName"),
                "serverUpdatedAt": data.get("serverUpdatedAt"),
            }
        )
    return out


class SyncHandler(BaseHTTPRequestHandler):
    server_version = "NoonReportSync/1.2"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{utc_now()}] {self.address_string()} {fmt % args}")

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        send_cors(self)
        self.end_headers()

    def _authorized(self) -> bool:
        auth = self.headers.get("Authorization", "")
        if auth == f"Bearer {API_TOKEN}":
            return True
        return API_TOKEN == "change-me-in-production" and not auth

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _serve_static(self, parsed_path: str) -> bool:
        if STATIC_DIR is None:
            return False
        rel = unquote(parsed_path).lstrip("/")
        if not rel or rel.endswith("/"):
            rel = "voyage_manager.html"
        candidate = (STATIC_DIR / rel).resolve()
        try:
            candidate.relative_to(STATIC_DIR)
        except ValueError:
            return False
        if not candidate.is_file():
            return False
        data = candidate.read_bytes()
        ctype = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        send_cors(self)
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            json_response(
                self,
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "noon-report-sync",
                    "version": "1.2",
                    "time": utc_now(),
                    "static": bool(STATIC_DIR),
                },
            )
            return

        parts = [p for p in parsed.path.strip("/").split("/") if p]
        if len(parts) >= 2 and parts[0] == "api" and parts[1] == "voyage":
            if not self._authorized():
                json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            try:
                if len(parts) == 3:
                    vessel = safe_slug(parts[2])
                    json_response(
                        self,
                        HTTPStatus.OK,
                        {"ok": True, "vesselId": vessel, "voyages": list_voyages(vessel)},
                    )
                    return
                if len(parts) == 4:
                    path = voyage_path(parts[2], parts[3])
                    if not path.exists():
                        json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})
                        return
                    data = json.loads(path.read_text(encoding="utf-8"))
                    etag = data.get("serverUpdatedAt") or data.get("updatedAt") or ""
                    if etag and self.headers.get("If-None-Match") == etag:
                        self.send_response(HTTPStatus.NOT_MODIFIED)
                        send_cors(self)
                        self.end_headers()
                        return
                    body = json.dumps(data, indent=2).encode("utf-8")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    if etag:
                        self.send_header("ETag", etag)
                    send_cors(self)
                    self.end_headers()
                    self.wfile.write(body)
                    return
            except ValueError:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid path"})
                return

        if self._serve_static(parsed.path):
            return

        json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.strip("/").split("/") if p]
        if not (len(parts) == 4 and parts[0] == "api" and parts[1] == "voyage"):
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not self._authorized():
            json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            path = voyage_path(parts[2], parts[3])
        except ValueError:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid path"})
            return

        try:
            incoming = self._read_json()
        except json.JSONDecodeError:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid json"})
            return

        existing = None
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))

        device_name = self.headers.get("X-Device-Name") or incoming.get("deviceName")
        if device_name:
            incoming["deviceName"] = str(device_name)[:128]
        device_id = self.headers.get("X-Device-Id") or incoming.get("deviceId")
        if device_id:
            incoming["deviceId"] = str(device_id)[:64]

        merged = merge_snapshots(existing, incoming)
        merged["serverUpdatedAt"] = utc_now()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(merged, indent=2), encoding="utf-8")
        json_response(self, HTTPStatus.OK, merged)


def merge_snapshots(server: dict | None, client: dict) -> dict:
    """Merge by record id, keeping the newest updatedAt per item. Honour delete tombstones."""
    if not server:
        return client

    server_data = server.get("data") or server
    client_data = client.get("data") or client

    deleted = merge_deleted_maps(
        server_data.get("deletedIds"),
        client_data.get("deletedIds"),
    )

    merged = {
        "vesselId": client.get("vesselId") or server.get("vesselId"),
        "voyageKey": client.get("voyageKey") or server.get("voyageKey"),
        "updatedAt": max(
            server.get("updatedAt") or "",
            client.get("updatedAt") or "",
        ),
        "deviceId": client.get("deviceId") or server.get("deviceId"),
        "deviceName": client.get("deviceName") or server.get("deviceName"),
        "data": {},
    }

    for key in ("setup",) + LIST_KEYS:
        server_items = server_data.get(key)
        client_items = client_data.get(key)

        if key == "setup":
            merged["data"]["setup"] = newer_setup(server_items, client_items)
            continue

        if not isinstance(server_items, list) and not isinstance(client_items, list):
            merged["data"][key] = client_items or server_items
            continue

        items = merge_lists_by_id(server_items or [], client_items or [])
        gone = set(deleted.get(key) or [])
        if gone:
            items = [i for i in items if i.get("id") not in gone]
        merged["data"][key] = items

    merged["data"]["deletedIds"] = deleted
    return merged


def merge_deleted_maps(a: dict | None, b: dict | None) -> dict:
    out: dict[str, list] = {k: [] for k in LIST_KEYS}
    for src in (a or {}, b or {}):
        for key in LIST_KEYS:
            vals = src.get(key) or []
            if isinstance(vals, list):
                out[key].extend(str(v) for v in vals if v)
    for key in LIST_KEYS:
        # keep newest unique ids, capped
        seen: list[str] = []
        for v in out[key]:
            if v not in seen:
                seen.append(v)
        out[key] = seen[-500:]
    return out


def newer_setup(server_setup: dict | None, client_setup: dict | None) -> dict:
    server_setup = server_setup or {}
    client_setup = client_setup or {}
    server_ts = (server_setup.get("sync") or {}).get("lastModifiedAt") or ""
    client_ts = (client_setup.get("sync") or {}).get("lastModifiedAt") or ""
    return client_setup if client_ts >= server_ts else server_setup


def merge_lists_by_id(server_items: list, client_items: list) -> list:
    by_id: dict[str, dict] = {}
    for item in server_items:
        if isinstance(item, dict) and item.get("id"):
            by_id[item["id"]] = item
    for item in client_items:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        prev = by_id.get(item["id"])
        if not prev or record_ts(item) >= record_ts(prev):
            by_id[item["id"]] = item
    return list(by_id.values())


def record_ts(item: dict) -> str:
    return (
        item.get("updatedAt")
        or item.get("savedAt")
        or item.get("uploadedAt")
        or item.get("printedAt")
        or ""
    )


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), SyncHandler)
    print(f"Noon Report sync server listening on http://{HOST}:{PORT}")
    print(f"Data directory: {DATA_DIR.resolve()}")
    if STATIC_DIR:
        print(f"Serving static PWA from: {STATIC_DIR}")
    if API_TOKEN == "change-me-in-production":
        print("WARNING: using default API token — set SYNC_API_TOKEN in production")
    print("Cloudflare Tunnel example:")
    print(f"  cloudflared tunnel --url http://127.0.0.1:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        httpd.server_close()


if __name__ == "__main__":
    main()

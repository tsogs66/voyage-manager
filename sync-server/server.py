#!/usr/bin/env python3
"""Self-hosted sync server for Noon Report / Voyage Manager.

Stores voyage snapshots as JSON files. Designed to run behind Cloudflare Tunnel
or nginx on a Linux server.

API:
  GET  /api/health
  GET  /api/voyage/<vessel>/<voyage>
  PUT  /api/voyage/<vessel>/<voyage>

Auth: Authorization: Bearer <SYNC_API_TOKEN>
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

DATA_DIR = Path(os.environ.get("SYNC_DATA_DIR", "./sync-data"))
API_TOKEN = os.environ.get("SYNC_API_TOKEN", "change-me-in-production")
HOST = os.environ.get("SYNC_HOST", "0.0.0.0")
PORT = int(os.environ.get("SYNC_PORT", "8787"))
ALLOWED_ORIGINS = os.environ.get(
    "SYNC_ALLOWED_ORIGINS",
    "*",
).split(",")

SLUG_RE = re.compile(r"^[a-zA-Z0-9._-]{1,64}$")


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
        "Authorization, Content-Type, If-None-Match",
    )
    handler.send_header("Access-Control-Max-Age", "86400")


class SyncHandler(BaseHTTPRequestHandler):
    server_version = "NoonReportSync/1.0"

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

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            json_response(
                self,
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "noon-report-sync",
                    "time": utc_now(),
                },
            )
            return

        parts = parsed.path.strip("/").split("/")
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "voyage":
            if not self._authorized():
                json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            try:
                path = voyage_path(parts[2], parts[3])
            except ValueError:
                json_response(self, HTTPStatus.BAD_REQUEST, {"error": "invalid path"})
                return
            if not path.exists():
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            data = json.loads(path.read_text(encoding="utf-8"))
            json_response(self, HTTPStatus.OK, data)
            return

        json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
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

        merged = merge_snapshots(existing, incoming)
        merged["serverUpdatedAt"] = utc_now()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(merged, indent=2), encoding="utf-8")
        json_response(self, HTTPStatus.OK, merged)


def merge_snapshots(server: dict | None, client: dict) -> dict:
    """Merge by record id, keeping the newest updatedAt per item."""
    if not server:
        return client

    server_data = server.get("data") or server
    client_data = client.get("data") or client

    merged = {
        "vesselId": client.get("vesselId") or server.get("vesselId"),
        "voyageKey": client.get("voyageKey") or server.get("voyageKey"),
        "updatedAt": max(
            server.get("updatedAt") or "",
            client.get("updatedAt") or "",
        ),
        "deviceId": client.get("deviceId") or server.get("deviceId"),
        "data": {},
    }

    for key in ("setup", "entries", "receipts", "documents", "abstracts", "printHistory"):
        server_items = server_data.get(key)
        client_items = client_data.get(key)

        if key == "setup":
            merged["data"]["setup"] = newer_setup(server_items, client_items)
            continue

        if not isinstance(server_items, list) and not isinstance(client_items, list):
            merged["data"][key] = client_items or server_items
            continue

        merged["data"][key] = merge_lists_by_id(server_items or [], client_items or [])

    return merged


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
    return item.get("updatedAt") or item.get("savedAt") or item.get("uploadedAt") or item.get("printedAt") or ""


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), SyncHandler)
    print(f"Noon Report sync server listening on http://{HOST}:{PORT}")
    print(f"Data directory: {DATA_DIR.resolve()}")
    if API_TOKEN == "change-me-in-production":
        print("WARNING: using default API token — set SYNC_API_TOKEN in production")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        httpd.server_close()


if __name__ == "__main__":
    main()

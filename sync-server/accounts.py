#!/usr/bin/env python3
"""Central account database for Noon Report / Voyage Manager.

One SQLite file beside the voyage JSON holds every login and every vessel:

  accounts   one row per login — admin, or a vessel user bound to one vessel_id
  vessels    the fleet register: slug, name, IMO, company, sync token
  sessions   bearer tokens handed out by /api/auth/login, with an expiry

A vessel's sync token is DERIVED, not random: HMAC-SHA256 over the vessel name
and IMO number under a server-held secret. The same name and IMO therefore
always regenerate the same token on the same server, so a ship that loses its
token gets it back by typing its name and IMO again — no reset, no re-issue.
The secret lives in this database, so tokens survive a restart but cannot be
recomputed by anyone who does not hold the file.

Passwords are PBKDF2-HMAC-SHA256 with a per-account salt. Stdlib only.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

PBKDF2_ROUNDS = 240_000
SESSION_TTL_HOURS = 12
TOKEN_LENGTH = 40
SLUG_RE = re.compile(r"^[a-zA-Z0-9._-]{1,64}$")

ROLE_ADMIN = "admin"
ROLE_VESSEL = "vessel"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.isoformat()


class AccountError(Exception):
    """Bad input from a caller — safe to report back as a 4xx."""


def normalize_imo(value: str) -> str:
    """IMO 9722101, imo9722101 and 9722101 are the same ship.

    The token is derived from this, so the normalization has to be stable or a
    ship would get a different token depending on how someone typed it.
    """
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        raise AccountError("IMO number is required and must contain digits")
    if len(digits) > 15:
        raise AccountError("IMO number is too long")
    return digits


def normalize_vessel_name(value: str) -> str:
    """Case and inner spacing are ignored: 'M/V  Fangcheng' == 'm/v fangcheng'."""
    name = re.sub(r"\s+", " ", str(value or "")).strip()
    if not name:
        raise AccountError("Vessel name is required")
    if len(name) > 120:
        raise AccountError("Vessel name is too long")
    return name.upper()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "").strip().lower())
    slug = re.sub(r"-{2,}", "-", slug).strip("-.")
    return slug[:64]


class AccountStore:
    """Thread-safe wrapper over the SQLite account database."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._create_schema()
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    # ---------------------------------------------------------------- schema

    def _create_schema(self) -> None:
        with self._lock, self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS vessels (
                    vessel_id   TEXT PRIMARY KEY,
                    vessel_name TEXT NOT NULL,
                    imo         TEXT NOT NULL UNIQUE,
                    company     TEXT NOT NULL DEFAULT '',
                    token       TEXT NOT NULL,
                    created_at  TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS accounts (
                    username      TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    password_salt TEXT NOT NULL,
                    role          TEXT NOT NULL,
                    vessel_id     TEXT,
                    created_at    TEXT NOT NULL,
                    disabled      INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token      TEXT PRIMARY KEY,
                    username   TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_vessel_token ON vessels(token);
                """
            )

    # -------------------------------------------------------------- settings

    def _get_setting(self, key: str) -> str | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
        return row["value"] if row else None

    def _set_setting(self, key: str, value: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def token_secret(self) -> str:
        """The HMAC key behind every vessel token. Created once, then reused."""
        secret = self._get_setting("token_secret")
        if not secret:
            secret = secrets.token_hex(32)
            self._set_setting("token_secret", secret)
        return secret

    # ----------------------------------------------------------------- token

    def derive_token(self, vessel_name: str, imo: str) -> str:
        """The key generator: same name + IMO on this server -> same token."""
        material = f"{normalize_vessel_name(vessel_name)}|{normalize_imo(imo)}"
        digest = hmac.new(
            self.token_secret().encode("utf-8"), material.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return digest[:TOKEN_LENGTH]

    # -------------------------------------------------------------- accounts

    @staticmethod
    def _hash_password(password: str, salt: str) -> str:
        if not password or len(password) < 6:
            raise AccountError("Password must be at least 6 characters")
        return hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS
        ).hex()

    def create_account(
        self, username: str, password: str, role: str, vessel_id: str | None = None
    ) -> dict:
        username = (username or "").strip().lower()
        if not SLUG_RE.match(username):
            raise AccountError(
                "Username must be 1-64 characters, letters/digits/dot/dash/underscore"
            )
        if role not in (ROLE_ADMIN, ROLE_VESSEL):
            raise AccountError("Role must be 'admin' or 'vessel'")
        if role == ROLE_VESSEL and not vessel_id:
            raise AccountError("A vessel account needs a vessel")
        salt = secrets.token_hex(16)
        password_hash = self._hash_password(password, salt)
        try:
            with self._lock, self._conn:
                self._conn.execute(
                    "INSERT INTO accounts "
                    "(username, password_hash, password_salt, role, vessel_id, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (username, password_hash, salt, role, vessel_id, iso(utc_now())),
                )
        except sqlite3.IntegrityError as exc:
            raise AccountError(f"Username '{username}' already exists") from exc
        return {"username": username, "role": role, "vesselId": vessel_id}

    def set_password(self, username: str, password: str) -> None:
        salt = secrets.token_hex(16)
        password_hash = self._hash_password(password, salt)
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE accounts SET password_hash = ?, password_salt = ? WHERE username = ?",
                (password_hash, salt, (username or "").strip().lower()),
            )
        if cur.rowcount == 0:
            raise AccountError("No such account")

    def delete_account(self, username: str) -> None:
        username = (username or "").strip().lower()
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM sessions WHERE username = ?", (username,))
            cur = self._conn.execute("DELETE FROM accounts WHERE username = ?", (username,))
        if cur.rowcount == 0:
            raise AccountError("No such account")

    def get_account(self, username: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM accounts WHERE username = ?",
                ((username or "").strip().lower(),),
            ).fetchone()
        return dict(row) if row else None

    def list_accounts(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT username, role, vessel_id, created_at, disabled "
                "FROM accounts ORDER BY role DESC, username"
            ).fetchall()
        return [
            {
                "username": r["username"],
                "role": r["role"],
                "vesselId": r["vessel_id"],
                "createdAt": r["created_at"],
                "disabled": bool(r["disabled"]),
            }
            for r in rows
        ]

    def has_admin(self) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM accounts WHERE role = ? LIMIT 1", (ROLE_ADMIN,)
            ).fetchone()
        return row is not None

    def verify_password(self, username: str, password: str) -> dict | None:
        account = self.get_account(username)
        if not account or account["disabled"]:
            # Spend the same work on a missing account so timing does not leak
            # which usernames exist.
            hashlib.pbkdf2_hmac("sha256", b"x", b"x" * 16, PBKDF2_ROUNDS)
            return None
        try:
            candidate = hashlib.pbkdf2_hmac(
                "sha256",
                (password or "").encode("utf-8"),
                bytes.fromhex(account["password_salt"]),
                PBKDF2_ROUNDS,
            ).hex()
        except ValueError:
            return None
        if hmac.compare_digest(candidate, account["password_hash"]):
            return account
        return None

    # --------------------------------------------------------------- vessels

    def upsert_vessel(
        self, vessel_name: str, imo: str, company: str = "", vessel_id: str | None = None
    ) -> dict:
        """Register a vessel and mint its token. Re-registering the same IMO
        updates the details in place and keeps the same slug."""
        name = normalize_vessel_name(vessel_name)
        imo_digits = normalize_imo(imo)
        token = self.derive_token(vessel_name, imo)
        display_name = re.sub(r"\s+", " ", str(vessel_name)).strip()

        existing = self.get_vessel_by_imo(imo_digits)
        slug = vessel_id or (existing or {}).get("vesselId") or slugify(name)
        if not SLUG_RE.match(slug or ""):
            raise AccountError("Could not derive a valid vessel id — set one explicitly")

        clash = self.get_vessel(slug)
        if clash and clash["imo"] != imo_digits:
            raise AccountError(
                f"Vessel id '{slug}' already belongs to IMO {clash['imo']} — choose another"
            )

        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO vessels (vessel_id, vessel_name, imo, company, token, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(imo) DO UPDATE SET "
                "  vessel_name = excluded.vessel_name, "
                "  company = excluded.company, "
                "  token = excluded.token",
                (slug, display_name, imo_digits, str(company or "").strip(), token, iso(utc_now())),
            )
        return self.get_vessel(slug) or {}

    def _vessel_row_to_dict(self, row: sqlite3.Row) -> dict:
        return {
            "vesselId": row["vessel_id"],
            "vesselName": row["vessel_name"],
            "imo": row["imo"],
            "company": row["company"],
            "token": row["token"],
            "createdAt": row["created_at"],
        }

    def get_vessel(self, vessel_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM vessels WHERE vessel_id = ?", (vessel_id or "",)
            ).fetchone()
        return self._vessel_row_to_dict(row) if row else None

    def get_vessel_by_imo(self, imo: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM vessels WHERE imo = ?", (normalize_imo(imo),)
            ).fetchone()
        return self._vessel_row_to_dict(row) if row else None

    def get_vessel_by_token(self, token: str) -> dict | None:
        """Constant-time match so a wrong token cannot be narrowed by timing."""
        if not token:
            return None
        with self._lock:
            rows = self._conn.execute("SELECT * FROM vessels").fetchall()
        match = None
        for row in rows:
            if hmac.compare_digest(row["token"], token):
                match = row
        return self._vessel_row_to_dict(match) if match else None

    def list_vessels(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM vessels ORDER BY vessel_name"
            ).fetchall()
        return [self._vessel_row_to_dict(r) for r in rows]

    def delete_vessel(self, vessel_id: str) -> None:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "DELETE FROM vessels WHERE vessel_id = ?", (vessel_id or "",)
            )
            self._conn.execute(
                "DELETE FROM sessions WHERE username IN "
                "(SELECT username FROM accounts WHERE vessel_id = ?)",
                (vessel_id or "",),
            )
            self._conn.execute(
                "DELETE FROM accounts WHERE vessel_id = ?", (vessel_id or "",)
            )
        if cur.rowcount == 0:
            raise AccountError("No such vessel")

    # -------------------------------------------------------------- sessions

    def create_session(self, username: str) -> dict:
        token = secrets.token_urlsafe(32)
        now = utc_now()
        expires = now + timedelta(hours=SESSION_TTL_HOURS)
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO sessions (token, username, created_at, expires_at) "
                "VALUES (?, ?, ?, ?)",
                (token, username, iso(now), iso(expires)),
            )
        return {"sessionToken": token, "expiresAt": iso(expires)}

    def get_session(self, token: str) -> dict | None:
        if not token:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT s.token, s.username, s.expires_at, a.role, a.vessel_id, a.disabled "
                "FROM sessions s JOIN accounts a ON a.username = s.username "
                "WHERE s.token = ?",
                (token,),
            ).fetchone()
        if not row or row["disabled"]:
            return None
        try:
            expires = datetime.fromisoformat(row["expires_at"])
        except ValueError:
            return None
        if expires <= utc_now():
            self.delete_session(token)
            return None
        return {
            "username": row["username"],
            "role": row["role"],
            "vesselId": row["vessel_id"],
            "expiresAt": row["expires_at"],
        }

    def delete_session(self, token: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM sessions WHERE token = ?", (token or "",))

    def purge_expired_sessions(self) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "DELETE FROM sessions WHERE expires_at <= ?", (iso(utc_now()),)
            )
        return cur.rowcount

    # ------------------------------------------------------------- bootstrap

    def ensure_admin(self, username: str, password: str) -> bool:
        """Create the first admin if the database has none. True if created."""
        if self.has_admin():
            return False
        self.create_account(username, password, ROLE_ADMIN)
        return True

    def is_empty(self) -> bool:
        """No accounts at all — the server still runs in single-token mode."""
        with self._lock:
            row = self._conn.execute("SELECT 1 FROM accounts LIMIT 1").fetchone()
        return row is None

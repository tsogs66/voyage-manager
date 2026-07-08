from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

from calculations import VoyageInputs, compute_metrics

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "voyage_performance.db"

app = Flask(__name__)


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS voyages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vessel_name TEXT NOT NULL,
                voyage_no TEXT NOT NULL,
                departure_port TEXT NOT NULL,
                arrival_port TEXT NOT NULL,
                report_date TEXT NOT NULL,
                distance_nm REAL NOT NULL,
                steaming_hours REAL NOT NULL,
                me_power_kw REAL NOT NULL,
                me_mcr_kw REAL NOT NULL,
                me_rpm REAL NOT NULL,
                propeller_pitch_m REAL NOT NULL,
                fuel_hfo_mt REAL NOT NULL,
                fuel_mgo_mt REAL NOT NULL,
                cargo_mt REAL NOT NULL,
                notes TEXT DEFAULT '',
                total_fuel_mt REAL NOT NULL,
                fuel_per_day_mt REAL NOT NULL,
                fuel_per_nm_mt REAL NOT NULL,
                avg_speed_kn REAL NOT NULL,
                sfoc_g_kwh REAL NOT NULL,
                engine_load_factor_pct REAL NOT NULL,
                propeller_slip_pct REAL NOT NULL,
                transport_work_tnm REAL NOT NULL,
                co2_emissions_t REAL NOT NULL,
                eeoi_g_co2_per_tnm REAL NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def parse_float(payload: dict[str, Any], field: str) -> float:
    value = payload.get(field)
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Field '{field}' must be a number.") from exc


def required_text(payload: dict[str, Any], field: str) -> str:
    value = str(payload.get(field, "")).strip()
    if not value:
        raise ValueError(f"Field '{field}' is required.")
    return value


def extract_voyage_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, float]]:
    text_fields = {
        "vessel_name": required_text(payload, "vessel_name"),
        "voyage_no": required_text(payload, "voyage_no"),
        "departure_port": required_text(payload, "departure_port"),
        "arrival_port": required_text(payload, "arrival_port"),
        "report_date": required_text(payload, "report_date"),
        "notes": str(payload.get("notes", "")).strip(),
    }

    numeric_fields = {
        "distance_nm": parse_float(payload, "distance_nm"),
        "steaming_hours": parse_float(payload, "steaming_hours"),
        "me_power_kw": parse_float(payload, "me_power_kw"),
        "me_mcr_kw": parse_float(payload, "me_mcr_kw"),
        "me_rpm": parse_float(payload, "me_rpm"),
        "propeller_pitch_m": parse_float(payload, "propeller_pitch_m"),
        "fuel_hfo_mt": parse_float(payload, "fuel_hfo_mt"),
        "fuel_mgo_mt": parse_float(payload, "fuel_mgo_mt"),
        "cargo_mt": parse_float(payload, "cargo_mt"),
    }

    for field, value in numeric_fields.items():
        if value < 0:
            raise ValueError(f"Field '{field}' cannot be negative.")

    return text_fields, numeric_fields


@app.get("/")
def index() -> str:
    return render_template("noon-report-v2_3.html")


@app.get("/simple")
def simple_dashboard() -> str:
    return render_template("index.html")


@app.get("/api/voyages")
def list_voyages():
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM voyages ORDER BY report_date DESC, id DESC"
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/voyages")
def create_voyage():
    data = request.get_json(silent=True) or {}
    try:
        text_fields, numeric_fields = extract_voyage_payload(data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    metrics = compute_metrics(
        VoyageInputs(
            distance_nm=numeric_fields["distance_nm"],
            steaming_hours=numeric_fields["steaming_hours"],
            me_power_kw=numeric_fields["me_power_kw"],
            me_mcr_kw=numeric_fields["me_mcr_kw"],
            me_rpm=numeric_fields["me_rpm"],
            propeller_pitch_m=numeric_fields["propeller_pitch_m"],
            fuel_hfo_mt=numeric_fields["fuel_hfo_mt"],
            fuel_mgo_mt=numeric_fields["fuel_mgo_mt"],
            cargo_mt=numeric_fields["cargo_mt"],
        )
    )

    payload = {**text_fields, **numeric_fields, **metrics.to_dict()}

    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO voyages (
                vessel_name, voyage_no, departure_port, arrival_port, report_date,
                distance_nm, steaming_hours, me_power_kw, me_mcr_kw, me_rpm, propeller_pitch_m,
                fuel_hfo_mt, fuel_mgo_mt, cargo_mt, notes,
                total_fuel_mt, fuel_per_day_mt, fuel_per_nm_mt, avg_speed_kn, sfoc_g_kwh,
                engine_load_factor_pct, propeller_slip_pct, transport_work_tnm,
                co2_emissions_t, eeoi_g_co2_per_tnm
            )
            VALUES (
                :vessel_name, :voyage_no, :departure_port, :arrival_port, :report_date,
                :distance_nm, :steaming_hours, :me_power_kw, :me_mcr_kw, :me_rpm, :propeller_pitch_m,
                :fuel_hfo_mt, :fuel_mgo_mt, :cargo_mt, :notes,
                :total_fuel_mt, :fuel_per_day_mt, :fuel_per_nm_mt, :avg_speed_kn, :sfoc_g_kwh,
                :engine_load_factor_pct, :propeller_slip_pct, :transport_work_tnm,
                :co2_emissions_t, :eeoi_g_co2_per_tnm
            )
            """,
            payload,
        )
        new_id = cursor.lastrowid

    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM voyages WHERE id = ?", (new_id,)).fetchone()

    return jsonify(dict(row)), 201


@app.delete("/api/voyages/<int:voyage_id>")
def delete_voyage(voyage_id: int):
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM voyages WHERE id = ?", (voyage_id,))
    if cursor.rowcount == 0:
        return jsonify({"error": "Voyage record not found."}), 404
    return jsonify({"status": "deleted", "id": voyage_id})


if __name__ == "__main__":
    init_db()
    app.run(debug=True)

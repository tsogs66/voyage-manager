# voyage-manager

Web-based voyage performance application with a local SQLite database.

This project is an upgrade path from an Excel/VBA workflow into a full web app for:

- fuel consumption tracking
- main engine performance monitoring
- ship performance during voyages

## Stack

- Backend: Python + Flask
- Database: SQLite (local file `voyage_performance.db`)
- Frontend: HTML/CSS/JavaScript

## Features

- Create voyage reports from a web form
- Persist records in local SQLite
- Automatically compute performance metrics per voyage:
  - Total fuel (mt)
  - Fuel per day (mt/day)
  - Fuel per nautical mile (mt/nm)
  - Average speed (kn)
  - SFOC (g/kWh)
  - Engine load factor (% MCR)
  - Propeller slip (%)
  - Transport work (tonne-nautical-mile)
  - CO2 emissions (tCO2)
  - EEOI proxy (gCO2/t·nm)
- List voyage history in dashboard table
- Delete records from UI

## Run locally

1. Create virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start app:
   ```bash
   python app.py
   ```
4. Open:
   - `http://127.0.0.1:5000`

## API

- `GET /api/voyages` - list all voyage reports
- `POST /api/voyages` - create a voyage report and compute metrics
- `DELETE /api/voyages/<id>` - delete a report

## Input data fields

Required text fields:
- `vessel_name`
- `voyage_no`
- `report_date`
- `departure_port`
- `arrival_port`

Required numeric fields:
- `distance_nm`
- `steaming_hours`
- `me_power_kw`
- `me_mcr_kw`
- `me_rpm`
- `propeller_pitch_m`
- `fuel_hfo_mt`
- `fuel_mgo_mt`
- `cargo_mt`

Optional:
- `notes`

## VBA files

The original VBA template files (`VBAApp.bas`, `VBADataAccess.bas`, `VBAValidation.bas`) are kept in the repository as a legacy reference for the Excel-based workflow.

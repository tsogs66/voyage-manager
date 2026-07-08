# Voyage Manager

A web application that replaces an Excel/VBA voyage-estimating workbook. It runs entirely in the browser — no server, no install, no macros.

## Run it

Open `index.html` in any modern browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## What it does

| Excel/VBA workbook | This app |
| --- | --- |
| Estimate sheet with formulas | **Estimator** tab — results recalculate live as you type |
| Voyage register sheet | **Voyages** tab — sortable, searchable table with edit/delete |
| Summary sheet / charts | **Dashboard** tab — KPIs, result-by-voyage chart, status counts |
| VBA macros (calc, save row) | `js/calc.js` calculation engine + save button |
| The `.xlsm` file itself | Browser localStorage (auto-saved) |
| Sharing the workbook | **Export CSV** / **Import CSV** buttons |

## Calculations

For each voyage the engine derives:

- **Sea days** = distance / (speed × 24), grossed up by the sea margin %, separately for ballast and laden legs.
- **Total days** = sea days + load/discharge/idle port days.
- **Gross freight** = cargo quantity × freight rate + lumpsum; **net freight** = gross − commission %.
- **Bunker cost** = (sea days × sea consumption + port days × port consumption) × price, for IFO and MGO.
- **Total expenses** = bunkers + port costs (load & discharge) + canal dues + other costs.
- **Voyage result** = net freight − total expenses.
- **TCE/day** = result / total days.

## Migrating data from Excel

1. In the app, click **Export CSV** once to see the expected column headers.
2. Arrange your Excel voyage data with those headers (extra columns are ignored) and save as CSV.
3. Click **Import CSV** in the Voyages tab.

## Project layout

```
index.html      – single-page UI (Dashboard / Voyages / Estimator)
css/styles.css  – styling
js/calc.js      – calculation engine (pure functions, Node-testable)
js/storage.js   – localStorage persistence
js/csv.js       – CSV import/export
js/app.js       – UI wiring
test/calc.test.js – unit tests (run: node test/calc.test.js)
```

## Notes

- Data lives in your browser's localStorage; use Export CSV for backups or to move between machines.
- If your original workbook has different formulas or fields, adjust `js/calc.js` (the maths) and the field list in `js/csv.js`.

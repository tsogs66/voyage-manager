# Voyage Manager

A web application for building **voyage estimates** for shipping/chartering
operations — vessels, voyages, ports of call, bunkers, and expenses — with a
live **P&L / TCE (Time Charter Equivalent)** calculation.

> **Note on scope:** this repository (and the task that created it) did not
> contain an actual Excel/VBA workbook to convert — no `.xlsm`/`.xls` file or
> VBA source was found anywhere in the project or attached to the request.
> Based on the repository name (`voyage-manager`), this app reimplements the
> logic of a classic shipping **"voyage estimator"** spreadsheet — the type of
> tool that is very commonly built in Excel with VBA macros in chartering
> departments (freight, commissions, bunker costs, port costs/days, and a
> resulting TCE per day). If you have the original workbook, share it and the
> data model / formulas below can be adjusted to match it exactly (sheet
> layout, macro logic, extra fields, etc.).

## What it does

- **Vessels** — maintain a small fleet with DWT, laden/ballast speed and
  consumption figures.
- **Voyages** — create a voyage estimate for a vessel: charterer, cargo,
  freight (lumpsum or per-MT), address commission and brokerage.
- **Ports of Call** — sequence of ports with distance from the previous port,
  ETA/ETD, port days and port costs.
- **Bunkers** — fuel consumed at sea/in port, by type, quantity and price.
- **Other Expenses** — agency fees, canal dues, insurance, etc.
- **P&L / TCE** — automatically computed on every change, following the
  standard voyage-estimate waterfall:

  ```
  Gross Freight
    - Address Commission
    - Brokerage
  = Net Freight
    - Bunker Costs
    - Port Costs
    - Other Expenses
  = Net Voyage Result

  Voyage Days = total port days + steaming days (distance / speed)
  TCE / Day   = Net Voyage Result / Voyage Days
  ```

- A **dashboard** with fleet-wide KPIs (total voyages, ongoing voyages, total
  net result, average TCE/day).

## Tech stack

- **Backend:** Node.js + Express, REST API under `/api`.
- **Database:** SQLite via `better-sqlite3` (file-based, zero external
  services required).
- **Frontend:** Vanilla HTML/CSS/JS single-page app (no build step), served
  as static files by the same Express server.

## Project structure

```
server/
  index.js                 Express app + static file serving
  db/index.js               SQLite connection + schema
  services/voyageCalculations.js   P&L / TCE calculation engine
  routes/vessels.js         Vessel CRUD API
  routes/voyages.js         Voyage CRUD + ports/bunkers/expenses API
public/
  index.html                App shell
  styles.css                Styling
  app.js                     Client-side routing, rendering, API calls
```

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:3000 in a browser. The SQLite database file is
created automatically at `data/voyage-manager.db` on first run.

## API overview

| Method | Path                                   | Description                        |
| ------ | --------------------------------------- | ----------------------------------- |
| GET    | `/api/vessels`                          | List vessels                        |
| POST   | `/api/vessels`                          | Create vessel                       |
| PUT    | `/api/vessels/:id`                      | Update vessel                       |
| DELETE | `/api/vessels/:id`                      | Delete vessel                       |
| GET    | `/api/voyages`                          | List voyages with computed P&L      |
| POST   | `/api/voyages`                          | Create voyage                       |
| GET    | `/api/voyages/:id`                      | Voyage detail with computed P&L     |
| PUT    | `/api/voyages/:id`                      | Update voyage                       |
| DELETE | `/api/voyages/:id`                      | Delete voyage                       |
| POST   | `/api/voyages/:id/ports`                | Add a port of call                  |
| DELETE | `/api/voyages/:id/ports/:portId`        | Remove a port of call               |
| POST   | `/api/voyages/:id/bunkers`              | Add a bunker entry                  |
| DELETE | `/api/voyages/:id/bunkers/:bunkerId`    | Remove a bunker entry               |
| POST   | `/api/voyages/:id/expenses`             | Add an other-expense entry          |
| DELETE | `/api/voyages/:id/expenses/:expenseId`  | Remove an other-expense entry       |

## Adapting this to your real spreadsheet

If you can provide the original Excel/VBA file (or a description of its
sheets, columns, and macro logic), the following can be tailored precisely:

- Database schema (`server/db/index.js`) — add/rename fields to match your
  columns.
- Calculation engine (`server/services/voyageCalculations.js`) — replicate
  the exact formulas your VBA macros use (e.g. different commission
  structures, demurrage/despatch, multiple cargoes, currency conversion).
- Frontend forms/tables (`public/app.js`, `public/index.html`) — mirror your
  sheet's layout and any additional data entry fields.

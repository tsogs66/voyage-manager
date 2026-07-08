# Voyage Manager

A modern maritime voyage management system — the web equivalent of an Excel/VBA-based operations tracker.

## Features

- **Dashboard** — Real-time KPIs, P&L charts, top vessel performance
- **Voyage Management** — Full CRUD: plan, track, and close voyages; record cargo, freight, and distance
- **Fleet Management** — Register and manage vessels (type, flag, DWT, IMO number, status)
- **Port Directory** — Manage ports with UN/LOCODE, coordinates, and timezone
- **Expense Tracking** — Log voyage expenses by category (fuel, port charges, crew, etc.)
- **Excel Export** — Export all voyage data and expenses to `.xlsx` (just like the VBA original)
- **Search & Filter** — Filter voyages by status, vessel, or keyword

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS, Recharts |
| Backend | Node.js, Express |
| Database | SQLite (via `better-sqlite3`) |
| Export | SheetJS (xlsx) |

## Getting Started

### Prerequisites

- Node.js 18+

### Install & Run

```bash
# Install root dev dependencies
npm install

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd frontend && npm install

# Run both servers concurrently from root
npm run dev
```

- Frontend: http://localhost:3000  
- Backend API: http://localhost:5000/api

### API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /api/voyages | List all voyages (supports ?search=&status=) |
| POST | /api/voyages | Create a voyage |
| PUT | /api/voyages/:id | Update a voyage |
| DELETE | /api/voyages/:id | Delete a voyage |
| GET | /api/voyages/stats | Dashboard statistics |
| GET | /api/voyages/export | Download Excel report |
| POST | /api/voyages/:id/expenses | Add an expense |
| GET | /api/vessels | List vessels |
| GET | /api/ports | List ports |

## Database

SQLite database is auto-created at `backend/voyage_manager.db` on first run, pre-seeded with demo data (4 vessels, 8 ports, 7 voyages).

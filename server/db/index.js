const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'voyage-manager.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS vessels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  imo_number TEXT,
  dwt REAL NOT NULL DEFAULT 0,
  speed_laden_knots REAL NOT NULL DEFAULT 0,
  speed_ballast_knots REAL NOT NULL DEFAULT 0,
  consumption_laden_mt REAL NOT NULL DEFAULT 0,
  consumption_ballast_mt REAL NOT NULL DEFAULT 0,
  consumption_port_mt REAL NOT NULL DEFAULT 0,
  fuel_type TEXT NOT NULL DEFAULT 'IFO380',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voyages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vessel_id INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  reference TEXT,
  charterer TEXT,
  cargo_type TEXT,
  cargo_quantity_mt REAL NOT NULL DEFAULT 0,
  freight_type TEXT NOT NULL DEFAULT 'PER_MT',
  freight_rate REAL NOT NULL DEFAULT 0,
  address_commission_pct REAL NOT NULL DEFAULT 0,
  brokerage_pct REAL NOT NULL DEFAULT 0,
  laycan_start TEXT,
  laycan_end TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ports_of_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER NOT NULL REFERENCES voyages(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  port_name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'LOAD',
  distance_from_previous_nm REAL NOT NULL DEFAULT 0,
  eta TEXT,
  etd TEXT,
  port_days REAL NOT NULL DEFAULT 0,
  port_cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bunkers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER NOT NULL REFERENCES voyages(id) ON DELETE CASCADE,
  fuel_type TEXT NOT NULL DEFAULT 'IFO380',
  location TEXT NOT NULL DEFAULT 'SEA',
  quantity_mt REAL NOT NULL DEFAULT 0,
  price_per_mt REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER NOT NULL REFERENCES voyages(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'OTHER',
  description TEXT,
  amount REAL NOT NULL DEFAULT 0
);
`);

module.exports = db;

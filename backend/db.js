const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'voyage_manager.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS vessels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    imo_number TEXT UNIQUE,
    vessel_type TEXT,
    flag TEXT,
    gross_tonnage REAL,
    dead_weight REAL,
    year_built INTEGER,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country TEXT,
    un_locode TEXT UNIQUE,
    latitude REAL,
    longitude REAL,
    timezone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS voyages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voyage_number TEXT UNIQUE NOT NULL,
    vessel_id INTEGER NOT NULL,
    port_of_departure_id INTEGER,
    port_of_arrival_id INTEGER,
    departure_date TEXT,
    arrival_date TEXT,
    status TEXT DEFAULT 'planned',
    cargo_type TEXT,
    cargo_quantity REAL,
    cargo_unit TEXT DEFAULT 'MT',
    freight_rate REAL,
    total_freight REAL,
    fuel_consumption REAL,
    distance_nm REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vessel_id) REFERENCES vessels(id),
    FOREIGN KEY (port_of_departure_id) REFERENCES ports(id),
    FOREIGN KEY (port_of_arrival_id) REFERENCES ports(id)
  );

  CREATE TABLE IF NOT EXISTS voyage_waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voyage_id INTEGER NOT NULL,
    port_id INTEGER NOT NULL,
    arrival_date TEXT,
    departure_date TEXT,
    sequence_order INTEGER,
    notes TEXT,
    FOREIGN KEY (voyage_id) REFERENCES voyages(id) ON DELETE CASCADE,
    FOREIGN KEY (port_id) REFERENCES ports(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voyage_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    expense_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (voyage_id) REFERENCES voyages(id) ON DELETE CASCADE
  );
`);

// Seed demo data if empty
const vesselCount = db.prepare('SELECT COUNT(*) as cnt FROM vessels').get();
if (vesselCount.cnt === 0) {
  const insertVessel = db.prepare(`
    INSERT INTO vessels (name, imo_number, vessel_type, flag, gross_tonnage, dead_weight, year_built, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVessel.run('MV Ocean Pioneer', '9123456', 'Bulk Carrier', 'Panama', 25000, 43000, 2010, 'active');
  insertVessel.run('MV Sea Dragon', '9234567', 'Container Ship', 'Liberia', 35000, 55000, 2015, 'active');
  insertVessel.run('MV Atlantic Star', '9345678', 'Tanker', 'Marshall Islands', 45000, 80000, 2018, 'active');
  insertVessel.run('MV Pacific Horizon', '9456789', 'General Cargo', 'Singapore', 18000, 28000, 2008, 'maintenance');

  const insertPort = db.prepare(`
    INSERT INTO ports (name, country, un_locode, latitude, longitude, timezone)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertPort.run('Port of Rotterdam', 'Netherlands', 'NLRTM', 51.9244, 4.4777, 'Europe/Amsterdam');
  insertPort.run('Port of Singapore', 'Singapore', 'SGSIN', 1.2897, 103.8501, 'Asia/Singapore');
  insertPort.run('Port of Shanghai', 'China', 'CNSHA', 31.2304, 121.4737, 'Asia/Shanghai');
  insertPort.run('Port of Houston', 'USA', 'USHOU', 29.7604, -95.3698, 'America/Chicago');
  insertPort.run('Port of Dubai', 'UAE', 'AEJEA', 25.2048, 55.2708, 'Asia/Dubai');
  insertPort.run('Port of Hamburg', 'Germany', 'DEHAM', 53.5753, 10.0153, 'Europe/Berlin');
  insertPort.run('Port of Antwerp', 'Belgium', 'BEANR', 51.2994, 4.3720, 'Europe/Brussels');
  insertPort.run('Port of Busan', 'South Korea', 'KRPUS', 35.1796, 129.0756, 'Asia/Seoul');

  const insertVoyage = db.prepare(`
    INSERT INTO voyages (voyage_number, vessel_id, port_of_departure_id, port_of_arrival_id,
      departure_date, arrival_date, status, cargo_type, cargo_quantity, cargo_unit,
      freight_rate, total_freight, fuel_consumption, distance_nm, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVoyage.run('V-2026-001', 1, 1, 2, '2026-01-10', '2026-02-05', 'completed', 'Iron Ore', 40000, 'MT', 12.5, 500000, 180, 8500, 'Smooth voyage');
  insertVoyage.run('V-2026-002', 2, 3, 4, '2026-02-15', '2026-03-20', 'completed', 'Electronics', 15000, 'MT', 45, 675000, 220, 11200, null);
  insertVoyage.run('V-2026-003', 3, 5, 1, '2026-03-01', '2026-03-22', 'completed', 'Crude Oil', 75000, 'MT', 8.5, 637500, 310, 3800, 'Minor engine issue resolved');
  insertVoyage.run('V-2026-004', 1, 2, 6, '2026-04-10', '2026-05-02', 'in_progress', 'Coal', 38000, 'MT', 11, 418000, 170, 8900, null);
  insertVoyage.run('V-2026-005', 2, 8, 7, '2026-05-15', '2026-06-10', 'in_progress', 'Containers', 12000, 'MT', 55, 660000, 240, 12000, null);
  insertVoyage.run('V-2026-006', 3, 4, 5, '2026-07-01', '2026-07-25', 'planned', 'LNG', 60000, 'MT', 18, 1080000, 280, 9500, 'High value cargo');
  insertVoyage.run('V-2026-007', 1, 6, 3, '2026-07-20', '2026-08-15', 'planned', 'Steel', 35000, 'MT', 13, 455000, 165, 9800, null);

  const insertExpense = db.prepare(`
    INSERT INTO expenses (voyage_id, category, description, amount, currency, expense_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertExpense.run(1, 'Fuel', 'Bunker fuel - HFO', 85000, 'USD', '2026-01-10');
  insertExpense.run(1, 'Port Charges', 'Port dues Rotterdam', 12000, 'USD', '2026-01-10');
  insertExpense.run(1, 'Port Charges', 'Port dues Singapore', 18000, 'USD', '2026-02-05');
  insertExpense.run(1, 'Crew', 'Crew wages January', 45000, 'USD', '2026-01-31');
  insertExpense.run(2, 'Fuel', 'Bunker fuel - VLSFO', 110000, 'USD', '2026-02-15');
  insertExpense.run(2, 'Port Charges', 'Port dues Shanghai', 22000, 'USD', '2026-02-15');
  insertExpense.run(2, 'Maintenance', 'Engine maintenance', 15000, 'USD', '2026-02-20');
  insertExpense.run(3, 'Fuel', 'Bunker fuel - MGO', 145000, 'USD', '2026-03-01');
  insertExpense.run(3, 'Port Charges', 'Port dues Dubai', 25000, 'USD', '2026-03-01');
  insertExpense.run(4, 'Fuel', 'Bunker fuel - HFO', 80000, 'USD', '2026-04-10');
}

module.exports = db;

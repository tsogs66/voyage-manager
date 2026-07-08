const express = require('express');
const router = express.Router();
const db = require('../db');
const XLSX = require('xlsx');

const voyageWithDetails = `
  SELECT v.*,
    vs.name as vessel_name, vs.vessel_type, vs.flag,
    pd.name as departure_port_name, pd.country as departure_country,
    pa.name as arrival_port_name, pa.country as arrival_country,
    (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE voyage_id = v.id) as total_expenses
  FROM voyages v
  LEFT JOIN vessels vs ON v.vessel_id = vs.id
  LEFT JOIN ports pd ON v.port_of_departure_id = pd.id
  LEFT JOIN ports pa ON v.port_of_arrival_id = pa.id
`;

router.get('/', (req, res) => {
  const { status, vessel_id, search } = req.query;
  let query = voyageWithDetails;
  const conditions = [];
  const params = [];

  if (status) { conditions.push("v.status = ?"); params.push(status); }
  if (vessel_id) { conditions.push("v.vessel_id = ?"); params.push(vessel_id); }
  if (search) {
    conditions.push("(v.voyage_number LIKE ? OR vs.name LIKE ? OR pd.name LIKE ? OR pa.name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY v.created_at DESC';

  const voyages = db.prepare(query).all(...params);
  res.json(voyages);
});

router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM voyages').get().count;
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM voyages GROUP BY status
  `).all();
  const totalFreight = db.prepare('SELECT COALESCE(SUM(total_freight), 0) as total FROM voyages').get().total;
  const totalExpenses = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses').get().total;
  const avgDistance = db.prepare('SELECT COALESCE(AVG(distance_nm), 0) as avg FROM voyages WHERE distance_nm IS NOT NULL').get().avg;
  const monthlyFreight = db.prepare(`
    SELECT strftime('%Y-%m', departure_date) as month,
      SUM(total_freight) as freight,
      SUM((SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE voyage_id = voyages.id)) as expenses,
      COUNT(*) as count
    FROM voyages
    WHERE departure_date IS NOT NULL
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();
  const topVessels = db.prepare(`
    SELECT vs.name, COUNT(v.id) as voyages, COALESCE(SUM(v.total_freight), 0) as total_freight
    FROM vessels vs
    LEFT JOIN voyages v ON v.vessel_id = vs.id
    GROUP BY vs.id
    ORDER BY total_freight DESC
    LIMIT 5
  `).all();

  res.json({
    total,
    byStatus,
    totalFreight,
    totalExpenses,
    netRevenue: totalFreight - totalExpenses,
    avgDistance,
    monthlyFreight: monthlyFreight.reverse(),
    topVessels,
  });
});

router.get('/export', (req, res) => {
  const voyages = db.prepare(voyageWithDetails + ' ORDER BY v.created_at DESC').all();
  const rows = voyages.map(v => ({
    'Voyage #': v.voyage_number,
    'Vessel': v.vessel_name,
    'Vessel Type': v.vessel_type,
    'Departure Port': v.departure_port_name,
    'Arrival Port': v.arrival_port_name,
    'Departure Date': v.departure_date,
    'Arrival Date': v.arrival_date,
    'Status': v.status,
    'Cargo Type': v.cargo_type,
    'Cargo Qty': v.cargo_quantity,
    'Unit': v.cargo_unit,
    'Freight Rate': v.freight_rate,
    'Total Freight (USD)': v.total_freight,
    'Total Expenses (USD)': v.total_expenses,
    'Net Revenue (USD)': (v.total_freight || 0) - (v.total_expenses || 0),
    'Distance (NM)': v.distance_nm,
    'Fuel Consumption (MT)': v.fuel_consumption,
    'Notes': v.notes,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Voyages');

  const expensesByVoyage = db.prepare(`
    SELECT v.voyage_number, e.category, e.description, e.amount, e.currency, e.expense_date
    FROM expenses e
    JOIN voyages v ON e.voyage_id = v.id
    ORDER BY v.voyage_number, e.expense_date
  `).all();
  const wsExp = XLSX.utils.json_to_sheet(expensesByVoyage.map(e => ({
    'Voyage #': e.voyage_number,
    'Category': e.category,
    'Description': e.description,
    'Amount': e.amount,
    'Currency': e.currency,
    'Date': e.expense_date,
  })));
  XLSX.utils.book_append_sheet(wb, wsExp, 'Expenses');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="voyage-report.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.get('/:id', (req, res) => {
  const voyage = db.prepare(voyageWithDetails + ' WHERE v.id = ?').get(req.params.id);
  if (!voyage) return res.status(404).json({ error: 'Voyage not found' });
  const expenses = db.prepare('SELECT * FROM expenses WHERE voyage_id = ? ORDER BY expense_date').all(req.params.id);
  const waypoints = db.prepare(`
    SELECT wp.*, p.name as port_name, p.country
    FROM voyage_waypoints wp
    JOIN ports p ON wp.port_id = p.id
    WHERE wp.voyage_id = ?
    ORDER BY wp.sequence_order
  `).all(req.params.id);
  res.json({ ...voyage, expenses, waypoints });
});

router.post('/', (req, res) => {
  const {
    voyage_number, vessel_id, port_of_departure_id, port_of_arrival_id,
    departure_date, arrival_date, status, cargo_type, cargo_quantity, cargo_unit,
    freight_rate, total_freight, fuel_consumption, distance_nm, notes
  } = req.body;

  if (!voyage_number || !vessel_id) {
    return res.status(400).json({ error: 'Voyage number and vessel are required' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO voyages (voyage_number, vessel_id, port_of_departure_id, port_of_arrival_id,
        departure_date, arrival_date, status, cargo_type, cargo_quantity, cargo_unit,
        freight_rate, total_freight, fuel_consumption, distance_nm, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(voyage_number, vessel_id, port_of_departure_id, port_of_arrival_id,
        departure_date, arrival_date, status || 'planned', cargo_type, cargo_quantity, cargo_unit || 'MT',
        freight_rate, total_freight, fuel_consumption, distance_nm, notes);

    const voyage = db.prepare(voyageWithDetails + ' WHERE v.id = ?').get(result.lastInsertRowid);
    res.status(201).json(voyage);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM voyages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Voyage not found' });

  const {
    voyage_number, vessel_id, port_of_departure_id, port_of_arrival_id,
    departure_date, arrival_date, status, cargo_type, cargo_quantity, cargo_unit,
    freight_rate, total_freight, fuel_consumption, distance_nm, notes
  } = req.body;

  try {
    db.prepare(`
      UPDATE voyages SET voyage_number=?, vessel_id=?, port_of_departure_id=?, port_of_arrival_id=?,
        departure_date=?, arrival_date=?, status=?, cargo_type=?, cargo_quantity=?, cargo_unit=?,
        freight_rate=?, total_freight=?, fuel_consumption=?, distance_nm=?, notes=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(voyage_number, vessel_id, port_of_departure_id, port_of_arrival_id,
        departure_date, arrival_date, status, cargo_type, cargo_quantity, cargo_unit || 'MT',
        freight_rate, total_freight, fuel_consumption, distance_nm, notes, req.params.id);

    res.json(db.prepare(voyageWithDetails + ' WHERE v.id = ?').get(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM voyages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Voyage not found' });
  db.prepare('DELETE FROM voyages WHERE id = ?').run(req.params.id);
  res.json({ message: 'Voyage deleted' });
});

// Expenses
router.post('/:id/expenses', (req, res) => {
  const { category, description, amount, currency, expense_date } = req.body;
  if (!category || !amount) return res.status(400).json({ error: 'Category and amount required' });
  const result = db.prepare(`
    INSERT INTO expenses (voyage_id, category, description, amount, currency, expense_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, category, description, amount, currency || 'USD', expense_date);
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id/expenses/:expId', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ? AND voyage_id = ?').run(req.params.expId, req.params.id);
  res.json({ message: 'Expense deleted' });
});

module.exports = router;

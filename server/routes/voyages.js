const express = require('express');
const db = require('../db');
const { computeVoyagePnL } = require('../services/voyageCalculations');

const router = express.Router();

function getFullVoyage(id) {
  const voyage = db.prepare('SELECT * FROM voyages WHERE id = ?').get(id);
  if (!voyage) return null;
  const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(voyage.vessel_id);
  const portsOfCall = db
    .prepare('SELECT * FROM ports_of_call WHERE voyage_id = ? ORDER BY sequence_no ASC')
    .all(id);
  const bunkers = db.prepare('SELECT * FROM bunkers WHERE voyage_id = ?').all(id);
  const expenses = db.prepare('SELECT * FROM expenses WHERE voyage_id = ?').all(id);
  return { voyage, vessel, portsOfCall, bunkers, expenses };
}

router.get('/', (req, res) => {
  const voyages = db
    .prepare(
      `SELECT voyages.*, vessels.name AS vessel_name
       FROM voyages
       JOIN vessels ON vessels.id = voyages.vessel_id
       ORDER BY voyages.created_at DESC`
    )
    .all();

  const withPnL = voyages.map((voyage) => {
    const full = getFullVoyage(voyage.id);
    const pnl = computeVoyagePnL(full);
    return { ...voyage, pnl };
  });

  res.json(withPnL);
});

router.get('/:id', (req, res) => {
  const full = getFullVoyage(req.params.id);
  if (!full || !full.vessel) return res.status(404).json({ error: 'Voyage not found' });
  const pnl = computeVoyagePnL(full);
  res.json({ ...full, pnl });
});

router.post('/', (req, res) => {
  const {
    vessel_id,
    reference = null,
    charterer = null,
    cargo_type = null,
    cargo_quantity_mt = 0,
    freight_type = 'PER_MT',
    freight_rate = 0,
    address_commission_pct = 0,
    brokerage_pct = 0,
    laycan_start = null,
    laycan_end = null,
    status = 'PLANNED',
    notes = null,
  } = req.body;

  const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(vessel_id);
  if (!vessel) return res.status(400).json({ error: 'A valid vessel_id is required' });

  const info = db
    .prepare(
      `INSERT INTO voyages
        (vessel_id, reference, charterer, cargo_type, cargo_quantity_mt, freight_type,
         freight_rate, address_commission_pct, brokerage_pct, laycan_start, laycan_end, status, notes)
       VALUES
        (@vessel_id, @reference, @charterer, @cargo_type, @cargo_quantity_mt, @freight_type,
         @freight_rate, @address_commission_pct, @brokerage_pct, @laycan_start, @laycan_end, @status, @notes)`
    )
    .run({
      vessel_id,
      reference,
      charterer,
      cargo_type,
      cargo_quantity_mt,
      freight_type,
      freight_rate,
      address_commission_pct,
      brokerage_pct,
      laycan_start,
      laycan_end,
      status,
      notes,
    });

  res.status(201).json(getFullVoyage(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM voyages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Voyage not found' });

  const merged = { ...existing, ...req.body, id: existing.id };
  db.prepare(
    `UPDATE voyages SET
      vessel_id = @vessel_id, reference = @reference, charterer = @charterer,
      cargo_type = @cargo_type, cargo_quantity_mt = @cargo_quantity_mt,
      freight_type = @freight_type, freight_rate = @freight_rate,
      address_commission_pct = @address_commission_pct, brokerage_pct = @brokerage_pct,
      laycan_start = @laycan_start, laycan_end = @laycan_end, status = @status, notes = @notes
     WHERE id = @id`
  ).run(merged);

  const full = getFullVoyage(existing.id);
  res.json({ ...full, pnl: computeVoyagePnL(full) });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM voyages WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Voyage not found' });
  res.status(204).send();
});

// --- Ports of call ---

router.post('/:id/ports', (req, res) => {
  const voyage = db.prepare('SELECT * FROM voyages WHERE id = ?').get(req.params.id);
  if (!voyage) return res.status(404).json({ error: 'Voyage not found' });

  const {
    sequence_no = 1,
    port_name,
    purpose = 'LOAD',
    distance_from_previous_nm = 0,
    eta = null,
    etd = null,
    port_days = 0,
    port_cost = 0,
  } = req.body;

  if (!port_name || !port_name.trim()) {
    return res.status(400).json({ error: 'port_name is required' });
  }

  const info = db
    .prepare(
      `INSERT INTO ports_of_call
        (voyage_id, sequence_no, port_name, purpose, distance_from_previous_nm, eta, etd, port_days, port_cost)
       VALUES (@voyage_id, @sequence_no, @port_name, @purpose, @distance_from_previous_nm, @eta, @etd, @port_days, @port_cost)`
    )
    .run({
      voyage_id: voyage.id,
      sequence_no,
      port_name: port_name.trim(),
      purpose,
      distance_from_previous_nm,
      eta,
      etd,
      port_days,
      port_cost,
    });

  const full = getFullVoyage(voyage.id);
  res.status(201).json({ ...full, pnl: computeVoyagePnL(full) });
});

router.delete('/:id/ports/:portId', (req, res) => {
  const info = db
    .prepare('DELETE FROM ports_of_call WHERE id = ? AND voyage_id = ?')
    .run(req.params.portId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Port of call not found' });
  const full = getFullVoyage(req.params.id);
  res.json({ ...full, pnl: computeVoyagePnL(full) });
});

// --- Bunkers ---

router.post('/:id/bunkers', (req, res) => {
  const voyage = db.prepare('SELECT * FROM voyages WHERE id = ?').get(req.params.id);
  if (!voyage) return res.status(404).json({ error: 'Voyage not found' });

  const { fuel_type = 'IFO380', location = 'SEA', quantity_mt = 0, price_per_mt = 0 } = req.body;

  const info = db
    .prepare(
      `INSERT INTO bunkers (voyage_id, fuel_type, location, quantity_mt, price_per_mt)
       VALUES (@voyage_id, @fuel_type, @location, @quantity_mt, @price_per_mt)`
    )
    .run({ voyage_id: voyage.id, fuel_type, location, quantity_mt, price_per_mt });

  const full = getFullVoyage(voyage.id);
  res.status(201).json({ ...full, pnl: computeVoyagePnL(full) });
});

router.delete('/:id/bunkers/:bunkerId', (req, res) => {
  const info = db
    .prepare('DELETE FROM bunkers WHERE id = ? AND voyage_id = ?')
    .run(req.params.bunkerId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Bunker entry not found' });
  const full = getFullVoyage(req.params.id);
  res.json({ ...full, pnl: computeVoyagePnL(full) });
});

// --- Expenses ---

router.post('/:id/expenses', (req, res) => {
  const voyage = db.prepare('SELECT * FROM voyages WHERE id = ?').get(req.params.id);
  if (!voyage) return res.status(404).json({ error: 'Voyage not found' });

  const { category = 'OTHER', description = null, amount = 0 } = req.body;

  const info = db
    .prepare(
      `INSERT INTO expenses (voyage_id, category, description, amount)
       VALUES (@voyage_id, @category, @description, @amount)`
    )
    .run({ voyage_id: voyage.id, category, description, amount });

  const full = getFullVoyage(voyage.id);
  res.status(201).json({ ...full, pnl: computeVoyagePnL(full) });
});

router.delete('/:id/expenses/:expenseId', (req, res) => {
  const info = db
    .prepare('DELETE FROM expenses WHERE id = ? AND voyage_id = ?')
    .run(req.params.expenseId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Expense not found' });
  const full = getFullVoyage(req.params.id);
  res.json({ ...full, pnl: computeVoyagePnL(full) });
});

module.exports = router;

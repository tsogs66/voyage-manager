const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const vessels = db.prepare('SELECT * FROM vessels ORDER BY name ASC').all();
  res.json(vessels);
});

router.get('/:id', (req, res) => {
  const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id);
  if (!vessel) return res.status(404).json({ error: 'Vessel not found' });
  res.json(vessel);
});

router.post('/', (req, res) => {
  const {
    name,
    imo_number = null,
    dwt = 0,
    speed_laden_knots = 0,
    speed_ballast_knots = 0,
    consumption_laden_mt = 0,
    consumption_ballast_mt = 0,
    consumption_port_mt = 0,
    fuel_type = 'IFO380',
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Vessel name is required' });
  }

  const stmt = db.prepare(`
    INSERT INTO vessels
      (name, imo_number, dwt, speed_laden_knots, speed_ballast_knots,
       consumption_laden_mt, consumption_ballast_mt, consumption_port_mt, fuel_type)
    VALUES (@name, @imo_number, @dwt, @speed_laden_knots, @speed_ballast_knots,
            @consumption_laden_mt, @consumption_ballast_mt, @consumption_port_mt, @fuel_type)
  `);
  const info = stmt.run({
    name: name.trim(),
    imo_number,
    dwt,
    speed_laden_knots,
    speed_ballast_knots,
    consumption_laden_mt,
    consumption_ballast_mt,
    consumption_port_mt,
    fuel_type,
  });

  const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(vessel);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Vessel not found' });

  const merged = { ...existing, ...req.body, id: existing.id };
  db.prepare(`
    UPDATE vessels SET
      name = @name, imo_number = @imo_number, dwt = @dwt,
      speed_laden_knots = @speed_laden_knots, speed_ballast_knots = @speed_ballast_knots,
      consumption_laden_mt = @consumption_laden_mt, consumption_ballast_mt = @consumption_ballast_mt,
      consumption_port_mt = @consumption_port_mt, fuel_type = @fuel_type
    WHERE id = @id
  `).run(merged);

  res.json(db.prepare('SELECT * FROM vessels WHERE id = ?').get(existing.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM vessels WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Vessel not found' });
  res.status(204).send();
});

module.exports = router;

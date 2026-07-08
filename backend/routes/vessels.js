const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const vessels = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM voyages WHERE vessel_id = v.id) as total_voyages,
      (SELECT COUNT(*) FROM voyages WHERE vessel_id = v.id AND status = 'in_progress') as active_voyages
    FROM vessels v
    ORDER BY v.name
  `).all();
  res.json(vessels);
});

router.get('/:id', (req, res) => {
  const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id);
  if (!vessel) return res.status(404).json({ error: 'Vessel not found' });
  res.json(vessel);
});

router.post('/', (req, res) => {
  const { name, imo_number, vessel_type, flag, gross_tonnage, dead_weight, year_built, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = db.prepare(`
      INSERT INTO vessels (name, imo_number, vessel_type, flag, gross_tonnage, dead_weight, year_built, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, imo_number, vessel_type, flag, gross_tonnage, dead_weight, year_built, status || 'active');
    const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(vessel);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { name, imo_number, vessel_type, flag, gross_tonnage, dead_weight, year_built, status } = req.body;
  const existing = db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Vessel not found' });
  try {
    db.prepare(`
      UPDATE vessels SET name=?, imo_number=?, vessel_type=?, flag=?, gross_tonnage=?, dead_weight=?, year_built=?, status=?
      WHERE id=?
    `).run(name, imo_number, vessel_type, flag, gross_tonnage, dead_weight, year_built, status, req.params.id);
    res.json(db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Vessel not found' });
  db.prepare('DELETE FROM vessels WHERE id = ?').run(req.params.id);
  res.json({ message: 'Vessel deleted' });
});

module.exports = router;

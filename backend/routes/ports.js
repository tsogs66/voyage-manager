const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const ports = db.prepare('SELECT * FROM ports ORDER BY name').all();
  res.json(ports);
});

router.get('/:id', (req, res) => {
  const port = db.prepare('SELECT * FROM ports WHERE id = ?').get(req.params.id);
  if (!port) return res.status(404).json({ error: 'Port not found' });
  res.json(port);
});

router.post('/', (req, res) => {
  const { name, country, un_locode, latitude, longitude, timezone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = db.prepare(`
      INSERT INTO ports (name, country, un_locode, latitude, longitude, timezone)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, country, un_locode, latitude, longitude, timezone);
    res.status(201).json(db.prepare('SELECT * FROM ports WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { name, country, un_locode, latitude, longitude, timezone } = req.body;
  const existing = db.prepare('SELECT * FROM ports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Port not found' });
  try {
    db.prepare(`
      UPDATE ports SET name=?, country=?, un_locode=?, latitude=?, longitude=?, timezone=?
      WHERE id=?
    `).run(name, country, un_locode, latitude, longitude, timezone, req.params.id);
    res.json(db.prepare('SELECT * FROM ports WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM ports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Port not found' });
  db.prepare('DELETE FROM ports WHERE id = ?').run(req.params.id);
  res.json({ message: 'Port deleted' });
});

module.exports = router;

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize DB (runs migrations and seeds)
require('./db');

app.use('/api/vessels', require('./routes/vessels'));
app.use('/api/ports', require('./routes/ports'));
app.use('/api/voyages', require('./routes/voyages'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Voyage Manager API running on http://localhost:${PORT}`);
});

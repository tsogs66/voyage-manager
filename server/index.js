const path = require('path');
const express = require('express');

const vesselsRouter = require('./routes/vessels');
const voyagesRouter = require('./routes/voyages');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/vessels', vesselsRouter);
app.use('/api/voyages', voyagesRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Voyage Manager server listening on http://localhost:${PORT}`);
});

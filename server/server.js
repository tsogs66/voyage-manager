#!/usr/bin/env node
/*
 * Noon Report sync server — single file, zero dependencies (Node.js >= 16).
 *
 * - Serves the app itself (voyage_manager.html, manifest, service worker, icons)
 *   so ships/phones can install it as a PWA straight from this server.
 * - POST /api/sync   : offline-first merge sync (last-write-wins per record,
 *                      monotonic per-ship revision counter for pulls).
 * - POST /api/health : reachability/auth check used by the app's "Test Connection".
 *
 * Data is stored as one JSON file per ship in DATA_DIR (default ./data).
 *
 * Usage:
 *   SYNC_TOKEN=your-shared-secret node server.js [--port 8088] [--data ./data] [--root ..]
 *
 * If SYNC_TOKEN is not set the server accepts unauthenticated requests and prints a
 * warning — always set a token when exposing it through a Cloudflare Tunnel.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const PORT = parseInt(process.env.PORT || arg('port', '8088'), 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || arg('data', path.join(__dirname, 'data')));
const STATIC_ROOT = path.resolve(process.env.STATIC_ROOT || arg('root', path.join(__dirname, '..')));
const TOKEN = process.env.SYNC_TOKEN || arg('token', '');
const MAX_BODY = 200 * 1024 * 1024; // BDN PDFs are synced as data URLs, allow large bodies

if (!TOKEN) {
  console.warn('[warn] SYNC_TOKEN is not set — the API accepts unauthenticated requests.');
  console.warn('[warn] Set one before exposing this server to the internet:  SYNC_TOKEN=... node server.js');
}
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- per-ship persistent store ---------------- */
function shipFile(shipId) {
  const safe = String(shipId || 'default').toLowerCase().replace(/[^a-z0-9-_]/g, '_').slice(0, 80) || 'default';
  return path.join(DATA_DIR, safe + '.json');
}

function loadShip(shipId) {
  const file = shipFile(shipId);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { maxRev: 0, records: {} };
  }
}

function saveShip(shipId, db) {
  const file = shipFile(shipId);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, file);
}

/* ---------------- sync merge ---------------- */
function handleSync(payload) {
  const shipId = payload.shipId || 'default';
  const sinceRev = Number(payload.sinceRev) || 0;
  const incoming = Array.isArray(payload.records) ? payload.records : [];
  const db = loadShip(shipId);

  let accepted = 0;
  for (const rec of incoming) {
    if (!rec || typeof rec.store !== 'string' || rec.id == null || typeof rec.updatedAt !== 'string') continue;
    const key = rec.store + '/' + rec.id;
    const existing = db.records[key];
    if (!existing || rec.updatedAt > existing.updatedAt) {
      db.records[key] = {
        store: rec.store,
        id: rec.id,
        updatedAt: rec.updatedAt,
        deleted: !!rec.deleted,
        data: rec.deleted ? null : rec.data,
        rev: ++db.maxRev
      };
      accepted++;
    }
  }
  if (accepted) saveShip(shipId, db);

  const out = [];
  for (const key of Object.keys(db.records)) {
    const r = db.records[key];
    if (r.rev > sinceRev) out.push({ store: r.store, id: r.id, updatedAt: r.updatedAt, deleted: r.deleted, data: r.data });
  }
  return { rev: db.maxRev, accepted, records: out };
}

/* ---------------- http plumbing ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8'
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function authorized(req) {
  if (!TOKEN) return true;
  const h = req.headers['authorization'] || '';
  return h === 'Bearer ' + TOKEN;
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/voyage_manager.html';
  const file = path.normalize(path.join(STATIC_ROOT, rel));
  if (!file.startsWith(STATIC_ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath.startsWith('/api/')) {
    if (!authorized(req)) { sendJson(res, 401, { error: 'unauthorized' }); return; }
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; }
      catch (e) { sendJson(res, 400, { error: 'invalid JSON' }); return; }
      try {
        if (urlPath === '/api/health') {
          sendJson(res, 200, { ok: true, name: 'noon-report-sync', version: VERSION, time: new Date().toISOString() });
        } else if (urlPath === '/api/sync' && req.method === 'POST') {
          const result = handleSync(payload);
          console.log(`[sync] ship=${payload.shipId || 'default'} in=${(payload.records || []).length} accepted=${result.accepted} out=${result.records.length} rev=${result.rev}`);
          sendJson(res, 200, result);
        } else {
          sendJson(res, 404, { error: 'unknown endpoint' });
        }
      } catch (e) {
        console.error('[error]', e);
        sendJson(res, 500, { error: 'server error: ' + e.message });
      }
    });
    return;
  }

  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
  console.log(`Noon Report sync server v${VERSION}`);
  console.log(`  app:   http://0.0.0.0:${PORT}/`);
  console.log(`  api:   http://0.0.0.0:${PORT}/api/sync`);
  console.log(`  data:  ${DATA_DIR}`);
  console.log(`  static:${STATIC_ROOT}`);
  console.log(`  auth:  ${TOKEN ? 'token required' : 'OPEN (no token set!)'}`);
});

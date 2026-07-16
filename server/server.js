#!/usr/bin/env node
/*
 * Noon Report — self-hosted sync server
 * ------------------------------------------------------------------
 * Zero-dependency Node.js server (uses only built-in modules) that:
 *   1. Serves the offline-first Noon Report PWA (the static files one
 *      directory up), and
 *   2. Provides a tiny sync API the app talks to so several devices
 *      (phone + PC) can share one voyage database through your own
 *      Linux box, typically exposed with a Cloudflare Tunnel.
 *
 * Storage is a plain JSON file per vessel under ./data. That keeps the
 * whole thing dependency-free and trivial to back up (just copy the
 * folder). Conflict resolution is last-write-wins per record, using the
 * client-supplied `updatedAt` wall-clock timestamp, with tombstones so
 * deletions propagate too.
 *
 * Run:   SYNC_TOKEN=my-secret node server/server.js
 * Env:   PORT (default 8787), SYNC_TOKEN (shared secret; if unset, auth
 *        is disabled — only do that on a trusted/private network),
 *        DATA_DIR (default ./data), STATIC_DIR (default ../ i.e. repo root).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8787', 10);
const SYNC_TOKEN = process.env.SYNC_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..');
const MAX_BODY = 64 * 1024 * 1024; // 64 MB — PDFs stored as data URLs can be large

const SYNC_COLLECTIONS = ['entries', 'receipts', 'documents', 'abstracts', 'printHistory'];

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------ storage ------------------------------ */
// Serialise writes per vessel so concurrent requests can't clobber each other.
const vesselLocks = new Map();
async function withVessel(vesselId, fn) {
  const prev = vesselLocks.get(vesselId) || Promise.resolve();
  let release;
  const next = new Promise((res) => { release = res; });
  vesselLocks.set(vesselId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (vesselLocks.get(vesselId) === next) vesselLocks.delete(vesselId);
  }
}

function vesselFile(vesselId) {
  const safe = String(vesselId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default';
  return path.join(DATA_DIR, safe + '.json');
}

function emptyDoc(vesselId) {
  const collections = {};
  SYNC_COLLECTIONS.forEach((c) => { collections[c] = {}; });
  return { vesselId, seq: 0, setup: null, collections };
}

async function loadVessel(vesselId) {
  try {
    const raw = await fsp.readFile(vesselFile(vesselId), 'utf8');
    const doc = JSON.parse(raw);
    doc.collections = doc.collections || {};
    SYNC_COLLECTIONS.forEach((c) => { doc.collections[c] = doc.collections[c] || {}; });
    if (typeof doc.seq !== 'number') doc.seq = 0;
    return doc;
  } catch (e) {
    if (e.code === 'ENOENT') return emptyDoc(vesselId);
    throw e;
  }
}

async function saveVessel(vesselId, doc) {
  const file = vesselFile(vesselId);
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(doc));
  await fsp.rename(tmp, file); // atomic on POSIX
}

/* ------------------------------ merge -------------------------------- */
// Last-write-wins by updatedAt. Returns true if the stored copy changed.
function mergeRecord(store, incoming) {
  if (!incoming || incoming.id == null) return false;
  const id = String(incoming.id);
  const existing = store[id];
  const inTs = Number(incoming.updatedAt) || 0;
  if (existing && Number(existing.updatedAt) >= inTs) return false;
  store[id] = {
    id,
    updatedAt: inTs,
    deleted: !!incoming.deleted,
    record: incoming.deleted ? null : (incoming.record ?? null),
  };
  return true;
}

/* ------------------------------ helpers ------------------------------ */
function send(res, status, body, headers) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }, headers || {}));
  res.end(payload);
}

function authorised(req) {
  if (!SYNC_TOKEN) return true;
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const provided = m ? m[1] : (req.headers['x-sync-token'] || '');
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(SYNC_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* --------------------------- static files ---------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/voyage_manager.html';
  const full = path.join(STATIC_DIR, path.normalize(rel));
  if (!full.startsWith(path.resolve(STATIC_DIR))) { send(res, 403, 'Forbidden'); return; }
  try {
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) { send(res, 403, 'Forbidden'); return; }
    const ext = path.extname(full).toLowerCase();
    const data = await fsp.readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  } catch (e) {
    send(res, 404, 'Not found');
  }
}

/* ------------------------------ routes ------------------------------- */
async function handleSync(req, res) {
  if (!authorised(req)) { send(res, 401, { error: 'unauthorised' }); return; }
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch (e) { send(res, 400, { error: 'bad json' }); return; }

  const vesselId = (payload.vesselId || 'default').toString();
  const since = Number(payload.since) || 0;
  const push = payload.push || {};

  const result = await withVessel(vesselId, async () => {
    const doc = await loadVessel(vesselId);
    let changed = false;

    // Apply pushed setup (LWW).
    if (push.setup && push.setup.value !== undefined) {
      const inTs = Number(push.setup.updatedAt) || 0;
      if (!doc.setup || Number(doc.setup.updatedAt) < inTs) {
        doc.seq += 1;
        doc.setup = { value: push.setup.value, updatedAt: inTs, rev: doc.seq };
        changed = true;
      }
    }
    // Apply pushed collection records (LWW).
    const pushCols = push.collections || {};
    SYNC_COLLECTIONS.forEach((col) => {
      const arr = Array.isArray(pushCols[col]) ? pushCols[col] : [];
      arr.forEach((rec) => {
        if (mergeRecord(doc.collections[col], rec)) {
          doc.seq += 1;
          doc.collections[col][String(rec.id)].rev = doc.seq;
          changed = true;
        }
      });
    });

    if (changed) await saveVessel(vesselId, doc);

    // Build the pull side: everything with rev > since.
    const outCollections = {};
    SYNC_COLLECTIONS.forEach((col) => {
      outCollections[col] = Object.values(doc.collections[col])
        .filter((r) => (r.rev || 0) > since)
        .map((r) => ({ id: r.id, updatedAt: r.updatedAt, deleted: r.deleted, record: r.record }));
    });
    const outSetup = (doc.setup && (doc.setup.rev || 0) > since)
      ? { value: doc.setup.value, updatedAt: doc.setup.updatedAt } : null;

    return { serverRev: doc.seq, serverTime: Date.now(), setup: outSetup, collections: outCollections };
  });

  send(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { send(res, 204, ''); return; }
    const url = req.url || '/';
    if (url === '/api/health') { send(res, 200, { ok: true, auth: !!SYNC_TOKEN, time: Date.now() }); return; }
    if (url.startsWith('/api/sync') && req.method === 'POST') { await handleSync(req, res); return; }
    if (url.startsWith('/api/')) { send(res, 404, { error: 'unknown endpoint' }); return; }
    if (req.method === 'GET' || req.method === 'HEAD') { await serveStatic(req, res, url); return; }
    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error('Request error:', e);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Noon Report sync server on http://0.0.0.0:${PORT}`);
  console.log(`  data dir : ${DATA_DIR}`);
  console.log(`  static   : ${STATIC_DIR}`);
  console.log(`  auth     : ${SYNC_TOKEN ? 'token required' : 'DISABLED (set SYNC_TOKEN to secure)'}`);
});

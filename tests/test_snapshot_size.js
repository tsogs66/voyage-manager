/*
 * Snapshot size: nothing may write an IndexedDB value big enough to take the
 * Android WebView down with it.
 *
 * The program already learned this the hard way for voyage legs -- "one
 * IndexedDB value big enough to hold every watch, photo and PDF kills the
 * Android WebView on Save Current Leg" -- and caps a single value at
 * VOYAGE_LEG_PART_CHARS, chunking anything larger.
 *
 * A snapshot is the WHOLE database, so it is the same problem an order of
 * magnitude worse: measured at 96-123 MB for a modest ship-year with scanned
 * requisitions in it, against a 160,000-char limit. That is ~700x over, and it
 * fires on restore, merge and pull.
 *
 * This test holds the three rules that keep it safe:
 *   1. no single value over the chunk limit
 *   2. a database too big to snapshot is REFUSED, not attempted
 *   3. stored snapshots are bounded, and pruned oldest-first
 *
 * Run: node tests/test_snapshot_size.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

function extract(name) {
  let start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const asyncAt = HTML.lastIndexOf('async ', start);
  if (asyncAt >= 0 && asyncAt + 'async '.length === start) start = asyncAt;
  let depth = 0;
  let i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}
function constExpr(name) {
  const m = HTML.match(new RegExp('const ' + name + ' = ([^;]+);'));
  if (!m) throw new Error(name + ' not found');
  return m[1].replace(/\s/g, '').split('*').reduce((a, b) => a * Number(b), 1);
}

const PART_CHARS = constExpr('VOYAGE_LEG_PART_CHARS');
const MAX_CHARS = constExpr('DB_SNAPSHOT_MAX_CHARS');
const BUDGET_CHARS = constExpr('DB_SNAPSHOT_BUDGET_CHARS');
const KEEP = constExpr('DB_SNAPSHOT_KEEP');

/* A fake IndexedDB that records every put, so the size of each value written
   can be asserted rather than hoped for. */
function makeDb() {
  const stores = { dbSnapshots: new Map(), dbSnapshotParts: new Map() };
  const puts = [];
  return {
    stores, puts,
    dbPut: async (name, row) => {
      puts.push({ store: name, chars: JSON.stringify(row).length, id: row.id });
      stores[name] = stores[name] || new Map();
      stores[name].set(row.id, row);
    },
    dbGet: async (name, key) => (stores[name] || new Map()).get(key),
    dbGetAll: async (name) => [...(stores[name] || new Map()).values()],
    dbDelete: async (name, key) => { (stores[name] || new Map()).delete(key); },
    dbIndexKeys: async (name, idx, val) =>
      [...(stores[name] || new Map()).values()].filter(r => r[idx] === val).map(r => r.id)
  };
}

function sandboxFor(db, payload, storageEstimate) {
  const sb = {
    console, JSON, Object, Array, Math, Number, String, Date, Promise, setTimeout, isFinite,
    VOYAGE_LEG_PART_CHARS: PART_CHARS,
    DB_SNAPSHOT_STORE: 'dbSnapshots',
    DB_SNAPSHOT_PARTS_STORE: 'dbSnapshotParts',
    DB_SNAPSHOT_PART_CHARS: PART_CHARS,
    DB_SNAPSHOT_MAX_CHARS: MAX_CHARS,
    DB_SNAPSHOT_BUDGET_CHARS: BUDGET_CHARS,
    DB_SNAPSHOT_KEEP: KEEP,
    DB_BACKUP_STORES: ['entries'],
    fmt: (v, d) => Number(v).toFixed(d),
    ensureDB: async () => {},
    collectFullDatabasePayload: async () => payload,
    /* The estimator reads the real stores; here it reads the payload's. */
    _sizingRows: payload && payload.stores && payload.stores.entries || [],
    countBackupRecords: () => 1,
    navigator: storageEstimate ? { storage: { estimate: async () => storageEstimate } } : {},
    dbPut: db.dbPut, dbGet: db.dbGet, dbGetAll: db.dbGetAll,
    dbDelete: db.dbDelete, dbIndexKeys: db.dbIndexKeys
  };
  vm.createContext(sb);
  /* dbGetAll is the fake store; for sizing, 'meta' is empty and 'entries'
     holds the payload rows, which is what a real database looks like. */
  const realGetAll = sb.dbGetAll;
  sb.dbGetAll = async (name) => {
    if (name === 'meta') return [];
    if (name === 'entries') return sb._sizingRows;
    return realGetAll(name);
  };
  vm.runInContext([
    extract('estimateSnapshotChars'),
    extract('dbSnapshotPartId'),
    extract('deleteStoredSnapshot'),
    extract('inflateSnapshot'),
    extract('pruneSnapshots'),
    extract('snapshotDatabase')
  ].join('\n'), sb);
  return sb;
}

/* A payload of a given JSON size. */
function payloadOf(chars) {
  const pad = 'x'.repeat(Math.max(0, chars - 60));
  return { format: 'noon-report-db-v1', counts: {}, stores: { entries: [{ id: 'e1', blob: pad }] } };
}

(async () => {
  console.log(`limits from source: part ${PART_CHARS.toLocaleString()} chars, ` +
    `max snapshot ${(MAX_CHARS / 1048576).toFixed(0)} MB, budget ${(BUDGET_CHARS / 1048576).toFixed(0)} MB, keep ${KEEP}`);

  /* ---- rule 1: no value over the chunk limit ------------------------- */
  {
    const big = payloadOf(2 * 1024 * 1024);          /* 2 MB: well over 160k */
    const db = makeDb();
    const sb = sandboxFor(db, big);
    const res = await sb.snapshotDatabase('before a restore');
    check('a multi-megabyte database is snapshotted', res.ok, true);
    check('and written in pieces', res.row.chunked, true);
    const biggest = Math.max(...db.puts.map(p => p.chars));
    check('no single value exceeds the chunk limit', biggest <= PART_CHARS + 512, true);
    console.log(`       largest single put: ${biggest.toLocaleString()} chars (limit ${PART_CHARS.toLocaleString()})`);
    check('the pieces are more than one', res.row.partCount > 1, true);

    /* And it must read back byte-for-byte, or the undo point is worthless. */
    const header = (await db.dbGetAll('dbSnapshots'))[0];
    const back = await sb.inflateSnapshot(header);
    check('a chunked snapshot reassembles exactly',
      JSON.stringify(back) === JSON.stringify(big), true);

    /* The header must be written AFTER its pieces: a header that lands first
       would advertise a snapshot that cannot be read if the write is cut off. */
    const headerPut = db.puts.findIndex(p => p.store === 'dbSnapshots');
    const lastPart = db.puts.map(p => p.store).lastIndexOf('dbSnapshotParts');
    check('the header is written after every piece', headerPut > lastPart, true);
  }

  /* A small database still goes in whole — no pointless chunking. */
  {
    const db = makeDb();
    const sb = sandboxFor(db, payloadOf(1000));
    const res = await sb.snapshotDatabase('before a restore');
    check('a small database is written whole', res.row.chunked, false);
    check('and reads back', JSON.stringify(await sb.inflateSnapshot(
      (await db.dbGetAll('dbSnapshots'))[0])).length > 900, true);
  }

  /* ---- rule 2: too big is refused, not attempted --------------------- */
  {
    const huge = payloadOf(MAX_CHARS + 1024);
    const db = makeDb();
    const sb = sandboxFor(db, huge);
    const res = await sb.snapshotDatabase('before a restore');
    check('a database over the maximum is refused', res.ok, false);
    check('nothing at all is written for it', db.puts.length, 0);
    /* Either the row-by-row estimate catches it first (the usual case, and the
       one that avoids building a copy at all) or the exact figure does. Both
       say it in megabytes against the limit. */
    check('and the reason is in megabytes a person can act on',
      /over \d+ MB, which is more than a snapshot is allowed/.test(res.reason) ||
      /over the \d+ MB a snapshot is allowed to take/.test(res.reason), true);
    check('the size is found without building a copy of the database',
      /async function estimateSnapshotChars/.test(HTML) &&
      /it is not to build the thing in order to find/.test(HTML), true);
    check('it does not throw — the caller decides', typeof res.reason, 'string');
  }

  /* ---- a device nearly out of storage -------------------------------- */
  {
    const db = makeDb();
    const sb = sandboxFor(db, payloadOf(2 * 1024 * 1024),
      { quota: 50 * 1024 * 1024, usage: 49 * 1024 * 1024 });   /* 1 MB free */
    const res = await sb.snapshotDatabase('before a restore');
    check('a nearly full device is refused rather than filled', res.ok, false);
    check('nothing is written there either', db.puts.length, 0);
    check('and the message says how little is left',
      /storage left, which is not enough/.test(res.reason), true);
  }
  {
    /* Plenty of room: it proceeds. */
    const db = makeDb();
    const sb = sandboxFor(db, payloadOf(1024 * 1024),
      { quota: 2000 * 1024 * 1024, usage: 10 * 1024 * 1024 });
    check('a device with room proceeds', (await sb.snapshotDatabase('x')).ok, true);
  }
  {
    /* No storage API (older WebViews): must not block on its absence. */
    const db = makeDb();
    const sb = sandboxFor(db, payloadOf(1024 * 1024), null);
    check('a browser with no storage estimate still snapshots',
      (await sb.snapshotDatabase('x')).ok, true);
  }

  /* ---- rule 3: stored snapshots are bounded -------------------------- */
  {
    const db = makeDb();
    /* Pre-load snapshots that together exceed the budget. */
    const each = Math.floor(BUDGET_CHARS / 3);
    for (let i = 0; i < 3; i++){
      await db.dbPut('dbSnapshots', {
        id: 'snap_old_' + i,
        takenAt: '2026-01-0' + (i + 1) + 'T00:00:00Z',
        chars: each, chunked: false, payload: {}
      });
    }
    db.puts.length = 0;
    const sb = sandboxFor(db, payloadOf(2 * 1024 * 1024));
    await sb.snapshotDatabase('before a restore');
    const kept = await db.dbGetAll('dbSnapshots');
    const total = kept.reduce((a, r) => a + (Number(r.chars) || 0), 0);
    check('stored snapshots stay inside the budget', total <= BUDGET_CHARS, true);
    check('the oldest went first',
      kept.some(r => r.id === 'snap_old_0'), false);
    check('and the newest is still there',
      kept.some(r => r.id === 'snap_old_2'), true);
  }
  {
    /* The count ceiling still applies when each one is small. */
    const db = makeDb();
    for (let i = 0; i < KEEP + 3; i++){
      await db.dbPut('dbSnapshots', {
        id: 'snap_s_' + i, takenAt: '2026-02-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z',
        chars: 1000, chunked: false, payload: {}
      });
    }
    const sb = sandboxFor(db, payloadOf(1000));
    await sb.snapshotDatabase('x');
    check('no more than the ceiling are kept',
      (await db.dbGetAll('dbSnapshots')).length <= KEEP, true);
  }

  /* Deleting a snapshot must take its pieces with it, or the parts store
     grows for ever and the device fills anyway. */
  {
    const db = makeDb();
    const sb = sandboxFor(db, payloadOf(2 * 1024 * 1024));
    const res = await sb.snapshotDatabase('x');
    const partsBefore = (await db.dbGetAll('dbSnapshotParts')).length;
    check('a chunked snapshot has pieces', partsBefore > 1, true);
    await sb.deleteStoredSnapshot(res.row.id);
    check('deleting it removes every piece', (await db.dbGetAll('dbSnapshotParts')).length, 0);
    check('and the header', (await db.dbGetAll('dbSnapshots')).length, 0);
  }

  /* An incomplete snapshot must say so rather than restore half a database. */
  {
    const db = makeDb();
    const sb = sandboxFor(db, payloadOf(2 * 1024 * 1024));
    const res = await sb.snapshotDatabase('x');
    const parts = await db.dbGetAll('dbSnapshotParts');
    await db.dbDelete('dbSnapshotParts', parts[1].id);
    let threw = '';
    try{ await sb.inflateSnapshot(await db.dbGet('dbSnapshots', res.row.id)); }
    catch(e){ threw = e.message; }
    check('a snapshot missing a piece refuses to inflate',
      /incomplete on this device/.test(threw), true);
  }

  /* ---- the callers must handle a refusal, not assume a way back ------- */
  check('the restore guard asks when no undo point can be taken',
    /NO UNDO POINT CAN BE TAKEN/.test(HTML), true);
  check('and cancelling changes nothing',
    /Cancelled — nothing on this device has been changed/.test(HTML), true);
  check('the pull asks too',
    /A pull OVERWRITES the local active leg\. Without a snapshot/.test(HTML), true);
  check('and a pull that took no snapshot does not claim it did',
    /No snapshot was taken, so this cannot be undone from inside the program/.test(HTML), true);
  check('the snapshot store is chunked in the schema',
    /dbSnapshotParts.*\n?.*createIndex\('snapId'/.test(HTML) ||
    /createObjectStore\('dbSnapshotParts'/.test(HTML), true);
  check('and the schema says why',
    /one IndexedDB value that big closes/.test(HTML), true);
  check('the roll-back inflates pieces rather than reading a payload field',
    /const payload = await inflateSnapshot\(snap\);/.test(HTML), true);

  console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/*
 * Backup integrity: a backup must carry a digest of its own body, and a restore
 * must refuse a file whose body no longer matches it. A truncated backup used to
 * import as a short one — the JSON still parsed, the restore ran, and the missing
 * tail was simply gone.
 *
 * Run: node tests/test_backup_integrity.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

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
  /* Keep a leading `async`: dropping it turns the body's awaits into a SyntaxError. */
  const asyncAt = HTML.lastIndexOf('async ', start);
  if (asyncAt >= 0 && asyncAt + 'async '.length === start) start = asyncAt;
  let depth = 0;
  let i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return HTML.slice(start, i + 1);
}

/* Node has no window.crypto.subtle on older runtimes; give the sandbox the real
   SHA-256 so the sha256 branch is the one under test, not the fallback. */
const subtleLike = {
  digest: async (algo, bytes) => {
    const h = crypto.createHash('sha256').update(Buffer.from(bytes)).digest();
    return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
  }
};

const sandbox = {
  console,
  TextEncoder,
  /* The digest yields to the main thread between records, so the sandbox needs
     a timer as well as a hash. Without it buildBackupIntegrity catches the
     ReferenceError and writes a header with no checksum -- which is the right
     behaviour in a browser that cannot hash, and a missing stub here. */
  setTimeout,
  crypto: { subtle: subtleLike },
  DB_BACKUP_FORMAT: 'noon-report-db-v1',
  BACKUP_INTEGRITY_VERSION: 1,
  currentAppVersionLabel: () => '1.0.330',
  Number, Object, Array, JSON, Math, String, WeakSet, Promise
};
vm.createContext(sandbox);
vm.runInContext(
  [
    extract('canonicalJsonString'),
    extract('fnv1a64Hex'),
    extract('digestText'),
    extract('countBackupRecords'),
    extract('backupIntegrityBody'),
    extract('digestBackupBody'),
    extract('buildBackupIntegrity'),
    extract('verifyBackupIntegrity')
  ].join('\n'),
  sandbox
);

const {
  canonicalJsonString, fnv1a64Hex, countBackupRecords, backupIntegrityBody,
  digestBackupBody, buildBackupIntegrity, verifyBackupIntegrity
} = sandbox;

function samplePayload() {
  return {
    format: 'noon-report-db-v1',
    exportedAt: '2026-10-24T00:00:00.000Z',
    vessels: [{ id: 'v1', name: 'MV Example' }],
    meta: [{ key: 'setup:v1', value: { shipName: 'MV Example' } }],
    stores: {
      entries: [{ id: 'e1', datetime: '2026-10-01T12:00:00Z' }, { id: 'e2' }],
      orbEntries: [{ id: 'o1' }]
    }
  };
}

(async () => {
  /* ---- canonical form -------------------------------------------------- */
  check('key order does not change the canonical form',
    canonicalJsonString({ b: 1, a: 2 }), canonicalJsonString({ a: 2, b: 1 }));
  check('array order does change it',
    canonicalJsonString([1, 2]) === canonicalJsonString([2, 1]), false);
  check('a cycle does not throw',
    (() => { const o = { a: 1 }; o.self = o; return typeof canonicalJsonString(o); })(), 'string');

  /* ---- counting -------------------------------------------------------- */
  check('records counted across meta and every store', countBackupRecords(samplePayload()), 4);

  /* ---- a good file ----------------------------------------------------- */
  const good = samplePayload();
  good.integrity = await buildBackupIntegrity(good);
  check('the header states the algorithm used', good.integrity.algo, 'sha256');
  check('the header states the record count', good.integrity.recordCount, 4);
  check('the header carries the build that wrote it', good.integrity.appVersion, '1.0.330');

  const okVerdict = await verifyBackupIntegrity(good);
  check('a backup verifies against its own header', { checked: okVerdict.checked, ok: okVerdict.ok },
    { checked: true, ok: true });

  /* The digest covers the body only, so re-stamping the header must not break it. */
  const restamped = JSON.parse(JSON.stringify(good));
  restamped.exportedAt = '2030-01-01T00:00:00.000Z';
  check('a changed header does not invalidate the body',
    (await verifyBackupIntegrity(restamped)).ok, true);

  /* ---- a truncated file ------------------------------------------------ */
  const short = JSON.parse(JSON.stringify(good));
  short.stores.entries.pop();
  const shortVerdict = await verifyBackupIntegrity(short);
  check('a truncated backup fails', { checked: shortVerdict.checked, ok: shortVerdict.ok },
    { checked: true, ok: false });
  check('and the reason names the record count', /holds 4 records but 3 were found/.test(shortVerdict.reason), true);

  /* ---- an edited file -------------------------------------------------- */
  const edited = JSON.parse(JSON.stringify(good));
  edited.stores.entries[0].datetime = '2026-10-02T12:00:00Z';
  const editedVerdict = await verifyBackupIntegrity(edited);
  check('an edited record fails the digest', editedVerdict.ok, false);
  check('and says so', /do not match the digest/.test(editedVerdict.reason), true);

  /* ---- an old file ----------------------------------------------------- */
  const legacy = samplePayload();
  const legacyVerdict = await verifyBackupIntegrity(legacy);
  check('a backup with no header still restores', legacyVerdict.ok, true);
  check('but is reported as unverified', legacyVerdict.checked, false);

  /* ---- a device with no SHA-256 ---------------------------------------- */
  /* Plain http on the ship LAN: crypto.subtle is absent. A SHA-256 backup must
     not read as corrupt there — it reads as unverifiable, with its count checked. */
  sandbox.crypto = {};
  const noSubtle = await sandbox.verifyBackupIntegrity(good);
  check('SHA-256 backup on a device without SHA-256 is not called corrupt',
    { checked: noSubtle.checked, ok: noSubtle.ok }, { checked: false, ok: true });
  const noSubtleShort = await sandbox.verifyBackupIntegrity(short);
  check('but a short one is still caught there by its count', noSubtleShort.ok, false);

  /* A file signed with the fallback verifies on such a device. */
  const weak = samplePayload();
  weak.integrity = await sandbox.buildBackupIntegrity(weak);
  check('without SHA-256 the fallback digest is used', weak.integrity.algo, 'fnv1a64');
  check('and a fallback-signed backup verifies', (await sandbox.verifyBackupIntegrity(weak)).ok, true);
  const weakEdited = JSON.parse(JSON.stringify(weak));
  weakEdited.meta[0].value.shipName = 'MV Other';
  check('a fallback-signed backup still catches an edit',
    (await sandbox.verifyBackupIntegrity(weakEdited)).ok, false);

  check('the fallback digest is 16 hex characters', /^[0-9a-f]{16}$/.test(fnv1a64Hex('x')), true);
  check('and differs for different text', fnv1a64Hex('a') === fnv1a64Hex('b'), false);

  /* ---- aliased records: the false-alarm that blocked good restores ----- */
  /* The same record is referenced from two places all over this database --
     a receipt held in a leg and in the live store, one setup object shared
     between legs. A cycle guard that remembers every object ever seen calls
     the second sighting a cycle and nulls it, which dropped real data from
     the digest AND only while the objects were shared: written to a file and
     read back there are two separate copies, which hash differently. A
     perfectly intact backup then came back "damaged" and the restore refused
     it -- the safety feature blocking the thing it exists to protect. */
  const shared = { id: 'r-shared', qty: 500, bdnNo: 'BDN-X' };
  const aliased = {
    format: 'noon-report-db-v1', vessels: [], meta: [],
    stores: { receipts: [shared], entries: [{ id: 'e-alias', receipt: shared }] }
  };
  check('an aliased record is serialised both times, not nulled',
    /"receipt":\{"bdnNo":"BDN-X","id":"r-shared","qty":500\}/.test(
      canonicalJsonString(backupIntegrityBody(aliased))) &&
    !/null/.test(canonicalJsonString(backupIntegrityBody(aliased))), true);

  aliased.integrity = await buildBackupIntegrity(aliased);
  const aliasRoundTrip = JSON.parse(JSON.stringify(aliased));
  check('and an intact backup holding one still verifies after a save and load',
    (await verifyBackupIntegrity(aliasRoundTrip)).ok, true);

  /* A real cycle must still be handled rather than throwing. */
  const cyc = { id: 'c' }; cyc.self = cyc;
  check('a true cycle is still caught', /"self":null/.test(canonicalJsonString(cyc)), true);
  const mutualA = { id: 'a' }, mutualB = { id: 'b' };
  mutualA.b = mutualB; mutualB.a = mutualA;
  check('and so is a mutual one', typeof canonicalJsonString(mutualA), 'string');

  /* ---- the digest must not need the whole database in memory at once --- */
  check('the digest is taken per record, not over the whole body',
    /async function digestBackupBody/.test(HTML) &&
    /await addOne\(name \+ '\/' \+ rid, row\)/.test(HTML), true);
  check('record ids and store names are rolled in, so a move cannot slip past',
    /lines\.push\('store:' \+ name \+ ':count=' \+ sorted\.length\)/.test(HTML), true);
  check('records are sorted by id so two devices agree',
    /Sorted by id so two devices holding the same records in a different/.test(HTML), true);
  /* Order of records must not change the digest -- two devices sync the same
     rows in different orders all the time. */
  const ordered = {
    format: 'noon-report-db-v1', vessels: [], meta: [],
    stores: { entries: [{ id: 'e1', v: 1 }, { id: 'e2', v: 2 }, { id: 'e3', v: 3 }] }
  };
  const reversed = {
    format: 'noon-report-db-v1', vessels: [], meta: [],
    stores: { entries: [{ id: 'e3', v: 3 }, { id: 'e2', v: 2 }, { id: 'e1', v: 1 }] }
  };
  const dOrdered = await buildBackupIntegrity(ordered);
  const dReversed = await buildBackupIntegrity(reversed);
  check('record order does not change the digest', dOrdered.digest, dReversed.digest);
  /* But a changed record still must. */
  const changed = JSON.parse(JSON.stringify(ordered));
  changed.stores.entries[1].v = 99;
  check('a changed record does change it',
    (await buildBackupIntegrity(changed)).digest === dOrdered.digest, false);
  /* And a removed one. */
  const fewer = { format: 'noon-report-db-v1', vessels: [], meta: [],
    stores: { entries: [{ id: 'e1', v: 1 }, { id: 'e2', v: 2 }] } };
  check('a removed record changes it too',
    (await buildBackupIntegrity(fewer)).digest === dOrdered.digest, false);

  /* ---- a device that cannot hash must still be able to back up --------- */
  /* The backup is the thing being protected. A file with no checksum
     restores as unverified; no file at all is a lost backup. */
  const noHash = Object.assign({}, sandbox);
  check('a header that states no checksum is unverifiable, not damaged',
    (await verifyBackupIntegrity({
      format: 'noon-report-db-v1', meta: [], vessels: [], stores: { entries: [{ id: 'x' }] },
      integrity: { algo: 'none', digest: '', recordCount: 1 }
    })), { checked: false, ok: true, actualCount: 1,
      note: 'The device that wrote this backup could not compute a checksum, so its contents cannot be verified.' });
  void noHash;

  /* ---- the guard is actually wired into the destructive paths ---------- */
  check('restore checks the file before clearing anything',
    /update\(\{ label: 'Checking the backup file…' \}\);\s*\n\s*const verdict = await guardBeforeOverwrite/.test(HTML), true);
  check('the guard refuses rather than writing',
    /This backup is damaged and was not restored/.test(HTML), true);
  check('a snapshot is taken before an overwrite',
    /await snapshotDatabase\(reason\)/.test(HTML), true);
  check('snapshots are not part of a backup file',
    HTML.includes("const DB_BACKUP_STORES = ['entries'") &&
    !/const DB_BACKUP_STORES = \[[^\]]*dbSnapshots/.test(HTML), true);
  check('the sync log is not part of a backup file either',
    !/const DB_BACKUP_STORES = \[[^\]]*syncLog/.test(HTML), true);
  check('an overwriting pull snapshots first',
    /snapshotDatabase\('before pulling the active leg from the server'\)/.test(HTML), true);

  console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/*
 * Sync merge: local tombstones must filter pulls, and same-watch offline creates
 * (different ids, same datetime+operation) must collapse to one row.
 *
 * Run: node tests/test_sync_merge.js
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
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
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

const sandbox = {
  console,
  state: { activeVesselId: 'v1', entries: [] },
  normalizeCondition: (c) => {
    const raw = String(c == null ? '' : c).trim().toUpperCase();
    if (raw === 'L' || raw === 'LADEN' || raw === 'LOADED') return 'L';
    return 'B';
  },
  canonicalOperation: (op) => String(op || '').trim().toUpperCase(),
  rememberDeleted: (store, id) => {
    sandbox._remembered.push([store, id]);
  },
  _remembered: []
};
vm.createContext(sandbox);
vm.runInContext(
  [
    extract('recordTs'),
    extract('mergeListsById'),
    extract('filterDeleted'),
    extract('mergeDeletedIds'),
    extract('entryContentKey'),
    extract('dedupeEntriesByContent')
  ].join('\n'),
  sandbox
);

console.log('\nsync merge keeps local deletes when the peer still has the row');
{
  const local = [{ id: 'a', datetime: '2026-09-01T12:00', operation: 'NOON - AT SEA', updatedAt: '2026-09-01T13:00:00.000Z' }];
  const remote = [
    { id: 'a', datetime: '2026-09-01T12:00', operation: 'NOON - AT SEA', updatedAt: '2026-09-01T12:30:00.000Z' },
    { id: 'b', datetime: '2026-09-02T12:00', operation: 'NOON - AT SEA', updatedAt: '2026-09-02T12:00:00.000Z' }
  ];
  const deleted = sandbox.mergeDeletedIds(
    { entries: ['a'], receipts: [], documents: [], abstracts: [], printHistory: [] },
    { entries: [], receipts: [], documents: [], abstracts: [], printHistory: [] }
  );
  const merged = sandbox.filterDeleted(sandbox.mergeListsById(remote, local), deleted.entries);
  check('tombstoned id a is gone', merged.map(e => e.id).sort(), ['b']);
  check('merged deletedIds still list a', deleted.entries.includes('a'), true);
}

console.log('\nsame watch on two devices collapses to one entry');
{
  const a = {
    id: 'dev1', vesselId: 'v1', voyageNumber: '10', condition: 'L',
    datetime: '2026-09-05T12:00', operation: 'NOON - AT SEA',
    updatedAt: '2026-09-05T12:10:00.000Z'
  };
  const b = {
    id: 'dev2', vesselId: 'v1', voyageNumber: '10', condition: 'L',
    datetime: '2026-09-05T12:00', operation: 'NOON - AT SEA',
    updatedAt: '2026-09-05T12:20:00.000Z'
  };
  const deleted = { entries: [], receipts: [], documents: [], abstracts: [], printHistory: [] };
  const out = sandbox.dedupeEntriesByContent([a, b], deleted);
  check('one row remains', out.length, 1);
  check('newest id wins', out[0].id, 'dev2');
  check('loser is tombstoned', deleted.entries, ['dev1']);
}

console.log('\ndelete-then-recreate does not keep the old id after merged tombstones');
{
  const oldRow = {
    id: 'old', vesselId: 'v1', voyageNumber: '10', condition: 'B',
    datetime: '2026-09-05T12:00', operation: 'NOON - AT SEA',
    updatedAt: '2026-09-05T11:00:00.000Z'
  };
  const neu = {
    id: 'new', vesselId: 'v1', voyageNumber: '10', condition: 'B',
    datetime: '2026-09-05T12:00', operation: 'NOON - AT SEA',
    updatedAt: '2026-09-05T12:00:00.000Z'
  };
  const deleted = sandbox.mergeDeletedIds(
    { entries: ['old'], receipts: [], documents: [], abstracts: [], printHistory: [] },
    { entries: [], receipts: [], documents: [], abstracts: [], printHistory: [] }
  );
  let merged = sandbox.filterDeleted(sandbox.mergeListsById([oldRow], [neu]), deleted.entries);
  merged = sandbox.dedupeEntriesByContent(merged, deleted);
  check('only the recreate remains', merged.map(e => e.id), ['new']);
  check('old id stays tombstoned', deleted.entries.includes('old'), true);
}

console.log('\nwiring');
check('pull merge uses merged tombstones', HTML.includes('const deleted = mergeDeletedIds(localSync.deletedIds, remoteData.deletedIds)'), true);
check('content dedupe runs on merge', HTML.includes('dedupeEntriesByContent(') && HTML.includes('filterDeleted(mergeListsById(remoteData.entries'), true);
check('persist purges tombstoned idb rows', HTML.includes('await purgeTombstonedFromDb()'), true);
check('server dedupes entries by content', fs.readFileSync(path.join(__dirname, '..', 'sync-server', 'server.py'), 'utf8').includes('dedupe_entries_by_content'), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks}` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);

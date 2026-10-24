/*
 * Background auto-sync: it must never interrupt the watch.
 *
 * The rules this guards, all of them things a watchkeeper would notice if broken:
 *   - push only, never an unattended pull that overwrites local rows
 *   - no progress overlay, no modal, no alert from a background run
 *   - it stands down while printing, while another job holds the database,
 *     and while offline
 *   - a failure backs off instead of hammering a down satellite link
 *
 * Run: node tests/test_background_sync.js
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

/* ---- the source-level guarantees ------------------------------------------ */

/* The disabled option was the whole reason auto-sync did nothing. */
check('the auto-sync option is selectable',
  /<option value="true">Background push after each save<\/option>/.test(HTML), true);
check('and the disabled placeholder is gone',
  /<option value="true" disabled>/.test(HTML), false);

/* Three places used to force the stored setting back to false on every read,
   which is why ticking the box did nothing. Defaulting it to false when nothing
   is stored is correct and stays; forcing it on a value that exists does not. */
check('the form read no longer discards the choice',
  /product policy: sync is always operator-initiated/.test(HTML), false);
check('the credential mirror no longer discards it',
  /Keep sync manual — ignore a stored autoSync:true/.test(HTML), false);
check('nothing assigns false unconditionally',
  /(?<!typeof s\.autoSync !== 'boolean'\) s\.)autoSync = false/.test(
    HTML.replace(/if \(typeof s\.autoSync !== 'boolean'\) s\.autoSync = false;/g, '')), false);
check('but it is still off unless it was turned on',
  /if \(typeof s\.autoSync !== 'boolean'\) s\.autoSync = false;/.test(HTML), true);
check('the form select is what decides it',
  /s\.autoSync = autoEl\.value === 'true';/.test(HTML), true);

/* A background run must not paint the activity overlay. */
check('a background run bypasses withActivity',
  /const runner = background\s*\n\s*\? \(id, label, fn\) => fn\(\{ update: \(\) => \{\} \}\)\s*\n\s*: withActivity;/.test(HTML), true);

/* Push only. The background path must never ask for a pull. */
const bgBody = extract('runBackgroundSync');
check('the background run pushes', /syncNow\(\{ background: true, policy: 'merge' \}\)/.test(bgBody), true);
check('and never sets pullOnly', /pullOnly/.test(bgBody), false);
check('and never alerts', /\balert\(/.test(bgBody), false);
check('and never confirms', /\bconfirm\(/.test(bgBody), false);

/* A failure has to be recorded somewhere the user can find it later. */
check('a failed background push is logged', /result: 'failed'/.test(bgBody), true);
check('and backs off rather than retrying at once',
  /_bgSyncBackoffMs = Math\.min\(BG_SYNC_BACKOFF_MAX_MS/.test(bgBody), true);

/* ---- the gate, run for real ----------------------------------------------- */

function makeSandbox(over) {
  const sb = Object.assign({
    console,
    navigator: { onLine: true },
    syncInFlight: null,
    _bgSyncRunning: false,
    _activityStack: [],
    printHoldActive: () => false,
    syncApiBase: () => 'http://192.168.1.10:8080',
    ensureSyncConfig: () => ({ autoSync: true }),
    Math, Date, Number, String, Object
  }, over || {});
  vm.createContext(sb);
  vm.runInContext([extract('backgroundSyncEnabled'), extract('backgroundSyncBlockedReason')].join('\n'), sb);
  return sb;
}

check('with everything clear it may run', makeSandbox().backgroundSyncBlockedReason(), '');

check('auto-sync off stops it',
  makeSandbox({ ensureSyncConfig: () => ({ autoSync: false }) }).backgroundSyncBlockedReason(),
  'auto-sync is off');

check('no server URL stops it',
  makeSandbox({ syncApiBase: () => '' }).backgroundSyncBlockedReason(),
  'auto-sync is off');

check('offline stops it',
  makeSandbox({ navigator: { onLine: false } }).backgroundSyncBlockedReason(), 'offline');

check('a print dialog stops it',
  makeSandbox({ printHoldActive: () => true }).backgroundSyncBlockedReason(), 'printing');

check('another job holding the database stops it',
  makeSandbox({ _activityStack: [{ id: 'db-backup' }] }).backgroundSyncBlockedReason(),
  'another job is running');

check('a sync already in flight stops it',
  makeSandbox({ syncInFlight: Promise.resolve() }).backgroundSyncBlockedReason(),
  'a sync is already running');

/* An unknown onLine (older WebViews report undefined) must not be read as offline. */
check('an unknown connection state does not block it',
  makeSandbox({ navigator: {} }).backgroundSyncBlockedReason(), '');

/* ---- saving a report queues a push, it does not perform one --------------- */
const markBody = extract('markPendingSync');
check('a save queues a background push', /scheduleBackgroundSync\('a report was saved'\)/.test(markBody), true);
check('and does not await a sync on the save path', /await/.test(markBody), false);

/* ---- a manual pull is still snapshotted ----------------------------------- */
check('the manual pull warns that a snapshot was taken',
  /A snapshot of this device was taken first/.test(HTML), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);

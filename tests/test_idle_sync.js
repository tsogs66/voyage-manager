/*
 * Auto-sync must wait for a 3-minute idle window so push/pull cannot stall
 * data entry. Manual syncNow still clears the idle timer.
 *
 * Run: node tests/test_idle_sync.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
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

const start = HTML.indexOf('const AUTO_SYNC_IDLE_MS');
const end = HTML.indexOf('(function bindSaveSyncSettingsButton', start);
if (start < 0 || end < 0) throw new Error('idle sync block not found');
let block = HTML.slice(start, end);
/* Bind idle state on the sandbox global (var), not script-local let/const. */
block = block
  .replace('const AUTO_SYNC_IDLE_MS', 'var AUTO_SYNC_IDLE_MS')
  .replace('let lastUserActivityAt', 'var lastUserActivityAt')
  .replace('let idleSyncWaiting', 'var idleSyncWaiting');

const timers = [];
const sandbox = {
  console,
  Date,
  Math,
  navigator: { onLine: true },
  window: {
    __syncIdleBound: false,
    addEventListener() {},
  },
  document: {
    visibilityState: 'visible',
    addEventListener() {},
  },
  clearTimeout(id) {
    const idx = timers.findIndex((t) => t.id === id);
    if (idx >= 0) timers.splice(idx, 1);
  },
  setTimeout(fn, ms) {
    const id = timers.length + 1;
    timers.push({ id, fn, ms });
    return id;
  },
  syncTimer: null,
  printHoldActive: () => false,
  ensureSyncConfig: () => ({ autoSync: true, pendingChanges: true }),
  syncNow: async () => { sandbox._syncCalls += 1; },
  _syncCalls: 0,
};
vm.createContext(sandbox);
vm.runInContext('var syncTimer = null;\n' + block, sandbox);

console.log('\nidle auto-sync waits a full 3-minute quiet window');
{
  sandbox.lastUserActivityAt = Date.now();
  sandbox.idleSyncWaiting = false;
  timers.length = 0;
  sandbox.queueBackgroundSync();
  check('arms idle wait', sandbox.idleSyncWaiting, true);
  check('schedules ~3 minutes', !!(timers.length === 1 && timers[0].ms >= 179000 && timers[0].ms <= 180000), true);
}

console.log('\noperator activity postpones the flush');
{
  sandbox.lastUserActivityAt = Date.now() - sandbox.AUTO_SYNC_IDLE_MS - 5000;
  timers.length = 0;
  sandbox.queueBackgroundSync();
  check('idle-ready wait is short', timers[0].ms, 1000);
  sandbox.noteUserActivity();
  check('activity reschedules toward 3 min', !!(timers.length >= 1 && timers[timers.length - 1].ms >= 179000), true);
}

console.log('\nwiring');
check('auto-sync label mentions idle', HTML.includes('After 3 min idle'), true);
check('idle tracking is bound at startup', HTML.includes('bindSyncIdleTracking();'), true);
check('manual sync clears idle timer', HTML.includes('idleSyncWaiting = false') && HTML.includes('clearTimeout(syncTimer)'), true);
check('old 1200ms debounce removed', !HTML.includes('}, 1200);'), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks}` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);

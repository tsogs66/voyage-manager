/*
 * Progress banner for sync, pull, push, and local load/save.
 *
 * The work used to finish in silence: a tablet on a slow ship link sat on
 * "● changes pending" until an alert popped. The stack of activity jobs is
 * what the banner reads; this file checks the stack itself, then that the
 * real call sites still name the steps.
 *
 * Run: node tests/test_activity_progress.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');

let failures = 0, checks = 0;
function check(label, actual, expected) {
  checks++;
  const ok = actual === expected
    || (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-9);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: expected ${expected}, got ${actual}`}`);
  if (!ok) failures++;
}

(async function main() {
  const beginMark = HTML.indexOf('/* ACTIVITY_PROGRESS_BEGIN */');
  const endMark = HTML.indexOf('/* ACTIVITY_PROGRESS_END */');
  if (beginMark < 0 || endMark < 0) {
    console.error('activity progress block not found');
    process.exit(1);
  }
  const block = HTML.slice(beginMark, endMark + '/* ACTIVITY_PROGRESS_END */'.length);

  const sandbox = { console, setTimeout, clearTimeout, Date, Math, Number, isFinite };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);

  console.log('\nthe banner markup is in the page');
  check('activity banner id', HTML.includes('id="activityBanner"'), true);
  check('progress track id', HTML.includes('id="activityBannerTrack"'), true);
  check('kicker distinguishes server from this device', HTML.includes('id="activityBannerKicker"'), true);

  console.log('\nthe stack reports nested server then local work');
  sandbox.beginActivity('sync', 'Pulling voyage 65 L from the server…', { source: 'server' });
  let snap = sandbox.activityProgressSnapshot();
  check('one job after begin', snap.length, 1);
  check('label is the pull', snap[0].label, 'Pulling voyage 65 L from the server…');
  check('source is the server', snap[0].source, 'server');
  check('percent is unknown until we count', snap[0].pct, null);

  sandbox.beginActivity('persist', 'Saving entries on this device…', {
    source: 'program', current: 12, total: 40
  });
  snap = sandbox.activityProgressSnapshot();
  check('nested save is a second job', snap.length, 2);
  check('the top job is the save', snap[1].id, 'persist');
  check('12 of 40 is 30 percent', snap[1].pct, 30);
  check('activityIsActive while work is on', sandbox.activityIsActive(), true);
  check('a server job is still underneath', sandbox.activityHasSource('server'), true);

  sandbox.endActivity('persist');
  snap = sandbox.activityProgressSnapshot();
  check('ending the save leaves the pull', snap.length, 1);
  check('the remaining job is still sync', snap[0].id, 'sync');

  sandbox.endActivity('sync');
  check('the stack is empty when both finish', sandbox.activityProgressSnapshot().length, 0);
  check('activityIsActive is false', sandbox.activityIsActive(), false);

  console.log('\nwithActivity always clears, even on throw');
  let threw = false;
  try {
    await sandbox.withActivity('boom', 'Should not stick…', async () => {
      throw new Error('nope');
    }, { source: 'server' });
  } catch (_err) {
    threw = true;
  }
  check('the wrapper rethrows', threw, true);
  check('the failed job is not left on the stack', sandbox.activityProgressSnapshot().length, 0);

  console.log('\nthe real operations still name the steps');
  const syncNow = HTML.slice(HTML.indexOf('async function syncNow'), HTML.indexOf('function queueBackgroundSync'));
  check('syncNow starts a sync activity', /withActivity\('sync'/.test(syncNow), true);
  check('syncNow says it is pulling', syncNow.includes('Pulling voyage'), true);
  check('syncNow says it is uploading', syncNow.includes('Uploading voyage'), true);
  check('persistAllToDb reports saving on this device', HTML.includes('Saving ${store} on this device'), true);
  check('push names the vessel upload', HTML.includes('Pushing ${vessel.name} to the server'), true);
  /* A vessel pull merges newer-of-local-vs-server rather than replacing the
     local stores, and the progress label says so. The assertion said "Pulling"
     for two releases after the label was deliberately reworded, which left
     main red on every push. */
  check('pull names the vessel merge', HTML.includes('Merging ${vessel.name} from the server'), true);
  check('startup opens the local database', HTML.includes('Opening the local database'), true);
  check('login says signing in', HTML.includes("withActivity('login', 'Signing in…'"), true);
  check('renderSyncUi does not wipe a live server status', HTML.includes("if (!activityHasSource('server'))"), true);

  if (failures) {
    console.log(`\nFAILED — ${failures} of ${checks} checks`);
    process.exit(1);
  }
  console.log(`\nPASSED — ${checks} checks`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

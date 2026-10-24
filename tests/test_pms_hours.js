/*
 * Running hours and maintenance.
 *
 * The failure that matters is a task that silently never falls due, or one that
 * reads overdue when it is not — either makes the list untrustworthy and a
 * Chief goes back to the notebook. So the cases below pin what happens when
 * something is NOT KNOWN, which is the common state on a real ship:
 *
 *   no counter reading       -> no due figure claimed
 *   never recorded as done   -> no due figure claimed (not "due at 0 + interval")
 *   no interval set          -> no due figure claimed
 *   a unit the log can't see -> null hours, not zero
 *
 * Run: node tests/test_pms_hours.js
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

const sandbox = {
  console, Math, Number, Object, Array, String, JSON, Date, isFinite,
  fmt: (v, d) => Number(v).toFixed(d),
  PMS_DUE_SOON_HRS: 250,
  state: { setup: {}, entries: [] },
  computeDerived: () => ({ rows: sandbox._rows }),
  _rows: [],
  effectiveCarryover: () => ({}),
  entryGeRunHours: (e, n) => (e && e.ge && e.ge[n] != null ? e.ge[n] : null),
  entryBlrRunHours: (e) => (e && e.blr != null ? e.blr : null)
};
vm.createContext(sandbox);
vm.runInContext([
  extract('numOrNull'),
  extract('pmsUnits'),
  extract('pmsNewUnit'),
  extract('pmsNewTask'),
  extract('pmsLoggedHoursSince'),
  extract('pmsTaskStatus'),
  extract('pmsDueList')
].join('\n'), sandbox);

const { pmsNewUnit, pmsNewTask, pmsTaskStatus, pmsDueList, pmsLoggedHoursSince } = sandbox;

/* ---- task status, and above all the unknowns ----------------------------- */

const unit = (counter) => Object.assign(pmsNewUnit('M/E'), { counterHrs: counter });
const task = (interval, lastDone) => Object.assign(pmsNewTask('Injector overhaul', interval), { lastDoneHrs: lastDone });

check('a task well inside its interval is ok',
  pmsTaskStatus(unit(10000), task(2000, 9000)).state, 'ok');
check('and says how many hours to go',
  pmsTaskStatus(unit(10000), task(2000, 9000)).toGo, 1000);
check('the due figure is last done plus the interval',
  pmsTaskStatus(unit(10000), task(2000, 9000)).dueAt, 11000);

check('a task close to its interval is due soon',
  pmsTaskStatus(unit(10900), task(2000, 9000)).state, 'soon');
check('exactly at the soon threshold is still soon',
  pmsTaskStatus(unit(10750), task(2000, 9000)).state, 'soon');
check('one hour before the threshold is not',
  pmsTaskStatus(unit(10749), task(2000, 9000)).state, 'ok');

check('a task past its interval is overdue',
  pmsTaskStatus(unit(11500), task(2000, 9000)).state, 'overdue');
check('exactly at the due hour counts as overdue, not ok',
  pmsTaskStatus(unit(11000), task(2000, 9000)).state, 'overdue');
check('and says by how much',
  /overdue by 500 hrs/.test(pmsTaskStatus(unit(11500), task(2000, 9000)).label), true);

/* The three unknowns. None of them may produce a due figure, because a figure
   invented from a missing input is worse than a blank. */
check('no counter reading claims nothing',
  pmsTaskStatus(unit(null), task(2000, 9000)),
  { state: 'no-counter', label: 'no counter reading', dueAt: null, toGo: null });

check('a task never recorded as done claims nothing',
  pmsTaskStatus(unit(10000), task(2000, null)),
  { state: 'never-done', label: 'never recorded as done', dueAt: null, toGo: null });

check('and is NOT treated as due at zero plus the interval',
  pmsTaskStatus(unit(10000), task(2000, null)).state === 'overdue', false);

check('no interval claims nothing',
  pmsTaskStatus(unit(10000), task(0, 9000)).state, 'no-interval');
check('a blank interval likewise',
  pmsTaskStatus(unit(10000), task(null, 9000)).state, 'no-interval');

/* A brand-new unit genuinely at zero hours is a real reading, not a missing one. */
check('a counter genuinely at zero is a reading',
  pmsTaskStatus(unit(0), task(2000, 0)).state, 'ok');
check('and its due figure is the interval',
  pmsTaskStatus(unit(0), task(2000, 0)).dueAt, 2000);

/* ---- ordering: what a Chief needs first --------------------------------- */
sandbox.state.setup.pmsUnits = [
  Object.assign(pmsNewUnit('A/E #1'), { counterHrs: 20000, tasks: [
    Object.assign(pmsNewTask('Top overhaul', 4000), { lastDoneHrs: 19000 }),       /* 3000 to go */
    Object.assign(pmsNewTask('LO change', 500), { lastDoneHrs: 19900 })            /* 400 to go  */
  ]}),
  Object.assign(pmsNewUnit('M/E'), { counterHrs: 50000, tasks: [
    Object.assign(pmsNewTask('Injector overhaul', 2000), { lastDoneHrs: 47500 }),  /* overdue 500 */
    Object.assign(pmsNewTask('Piston pull', 12000), { lastDoneHrs: 44000 }),       /* 6000 to go  */
    pmsNewTask('Crankcase inspection', 8000)                                       /* never done  */
  ]})
];
const due = pmsDueList();
check('every task across every unit is listed', due.length, 5);
check('the overdue one comes first', due[0].task.name, 'Injector overhaul');
check('then the nearest due', due[1].task.name, 'LO change');
check('then by hours to go', due.slice(2, 4).map(d => d.task.name), ['Top overhaul', 'Piston pull']);
check('and the ones with nothing to say come last', due[4].status.state, 'never-done');

/* ---- hours since the last reading, from the log ------------------------- */

sandbox._rows = [
  { id: 'r1', datetime: '2026-03-01T12:00:00Z', hrs: 24, meHrs: 24, distEngine: 300, meCons: 20, dailyRevs: 1000 },
  { id: 'r2', datetime: '2026-03-02T12:00:00Z', hrs: 24, meHrs: 24, distEngine: 300, meCons: 20, dailyRevs: 1000 },
  /* in port: engine stopped, so no M/E hours */
  { id: 'r3', datetime: '2026-03-03T12:00:00Z', hrs: 24, meHrs: 0, distEngine: 0, meCons: 0, dailyRevs: 0 }
];
sandbox.state.entries = [
  { id: 'r1', ge: { 1: 12 }, blr: 3 },
  { id: 'r2', ge: { 1: 20 }, blr: 2 },
  { id: 'r3', ge: { 1: 24 }, blr: 6 }
];

check('main engine hours count only steaming periods',
  pmsLoggedHoursSince({ name: 'M/E' }, '2026-02-28T00:00:00Z'), 48);
check('a reading taken mid-window only counts after it',
  pmsLoggedHoursSince({ name: 'M/E' }, '2026-03-01T18:00:00Z'), 24);
check('a reading after every report counts nothing',
  pmsLoggedHoursSince({ name: 'M/E' }, '2026-04-01T00:00:00Z'), 0);

check('a generator is matched by its number',
  pmsLoggedHoursSince({ name: 'A/E #1' }, '2026-02-28T00:00:00Z'), 56);
check('the D/G spelling works too',
  pmsLoggedHoursSince({ name: 'D/G 1' }, '2026-02-28T00:00:00Z'), 56);
check('a generator the log has no hours for comes back as nothing run',
  pmsLoggedHoursSince({ name: 'A/E #2' }, '2026-02-28T00:00:00Z'), 0);

check('the boiler is matched by name',
  pmsLoggedHoursSince({ name: 'Aux boiler' }, '2026-02-28T00:00:00Z'), 11);

/* The important one: a unit the log cannot measure must be UNKNOWN, not zero.
   Zero would let a task sit at the same hours for ever and never fall due. */
check('a unit the log cannot see is unknown, not zero',
  pmsLoggedHoursSince({ name: 'Sewage treatment plant' }, '2026-02-28T00:00:00Z'), null);
check('and so is a purifier',
  pmsLoggedHoursSince({ name: 'LO purifier' }, '2026-02-28T00:00:00Z'), null);

check('no reading date means nothing can be offered',
  pmsLoggedHoursSince({ name: 'M/E' }, null), null);
check('a nonsense date likewise',
  pmsLoggedHoursSince({ name: 'M/E' }, 'not a date'), null);

/* ---- wiring -------------------------------------------------------------- */
check('units live in setup, so they ride the backup and the sync',
  /if \(!Array\.isArray\(setup\.pmsUnits\)\) setup\.pmsUnits = \[\];/.test(HTML), true);
check('the counter is never advanced without being confirmed',
  /Apply them as the current readings, dated today\?/.test(HTML), true);
check('and the machine is stated to be the authority',
  /the counter on the machine is what counts/i.test(HTML), true);
check('an empty box is kept as unknown rather than zero',
  /An empty box means "not known", which is not the same as zero/.test(HTML), true);
check('the printed list says what "never recorded as done" means',
  /no due figure is claimed for it/.test(HTML), true);
check('the due list is on the page',
  HTML.includes('id="pmsDueBody"') && HTML.includes('Falling due'), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);

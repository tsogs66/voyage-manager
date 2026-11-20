#!/usr/bin/env node
/*
 * Receipts carry a time, and R.O.B. follows the clock:
 *  - a receipt joins the first report at or after the time it was logged (not the whole day);
 *  - Present R.O.B. = Previous + receipts − consumption;
 *  - an old date-only receipt keeps its whole-day rule.
 * (How a bunker survey and a late receipt work together is in test_survey_previous_basis.js.)
 * Run: node tests/test_receipt_time.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'voyage_manager.html'), 'utf8');
let checks = 0, failures = 0;
function check(label, cond) { checks++; if (!cond) failures++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`); }
function extract(name) {
  const start = HTML.indexOf(`function ${name}(`); if (start < 0) throw new Error(name + ' not found');
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}') { depth--; if (!depth) break; } }
  return HTML.slice(start, i + 1);
}
const FUEL = [{ id: 'hfo', name: 'HFO TK', grade: 'HFO' }];
function sandbox(state) {
  const sb = {
    state, FUEL_TYPES: ['HFO', 'LSFO', 'MDO/MGO', 'LSMGO'],
    fuelTankList: () => FUEL, lubeTankList: () => [], fwTankList: () => [],
    tankRobValue: (s, t) => s?.[t.id] ?? s?.[t.name] ?? 0,
    receiptMatchesTank: (r, t, c) => !!(r && t && r.category === c && r.tankId === t.id),
    deductGradeConsumption: (rob, tanks, g, k, amt) => { const grp = tanks.filter(t => t[k] === g); if (!grp.length || !(amt > 0)) return; grp.forEach(t => { rob[t.id] = (rob[t.id] || 0) - amt; }); },
    deductLubeConsumption: () => {}, computeDerived: () => ({ rows: state._rows }), latestFwRob: () => 0, latestFwRobByTank: () => ({}), console,
    sortedEntries: () => state.entries.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime)),
  };
  vm.createContext(sb);
  vm.runInContext(['entryHasStampedReceived', 'stampedReceivedAsOf', 'receiptDayAfter', 'receiptMoment', 'receiptJoinedBy', 'receiptAfterSurvey',
    'receiptTargetEntry', 'latestRobSurveyAtOrBefore', 'receiptMatchesTankStrict', 'bookReceivedPreferOnce', 'robAsOfComputedRow', 'entryRobReceivedQty'].map(extract).join('\n'), sb);
  return sb;
}
const row = (id, dt, cum) => ({ id, datetime: dt, cumFuel: { HFO: cum, LSFO: 0, 'MDO/MGO': 0, LSMGO: 0 }, cumLube: {} });
const rows3 = () => [row('e1', '2026-09-01T06:00', 10), row('e2', '2026-09-01T18:00', 20), row('e3', '2026-09-02T06:00', 30)];
const rob = (sb, rs) => rs.map((r) => sb.robAsOfComputedRow(r, rs).rob.hfo);
const eq = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const entriesOf = (rs, extra) => rs.map((r) => Object.assign({ id: r.id, datetime: r.datetime }, (extra || {})[r.id] || {}));
const rcpt = (o) => Object.assign({ id: 'r', category: 'fuel', tankId: 'hfo', qty: 100 }, o);

console.log('\nsource guards');
check('the receipts form has a time', HTML.includes('id="rcpt_time"'));
check('a logged receipt stores its time', HTML.includes("{ time }") || HTML.includes('{ time } : {}'));
check('the receipts list says which report each one goes into', HTML.includes('receiptEntryTargetText(r)'));
check('the report shows the receipts-log items inside its R.O.B.', HTML.includes('id="vsRobReceiptsLog"') && HTML.includes('R.O.B. = Previous + receipts − consumption'));

console.log('\n1) a receipt goes into the first report at or after its time');
{
  const rs = rows3(); const st = { setup: { rob: { hfo: 500 } }, entries: entriesOf(rs), receipts: [rcpt({ date: '2026-09-01', time: '12:00' })], _rows: rs };
  check('logged 12:00 between the 06:00 and 18:00 reports: 490, 580, 570', eq(rob(sandbox(st), rs), [490, 580, 570]));
  st.receipts = [rcpt({ date: '2026-09-01', time: '18:00' }), rcpt({ id: 'r2', date: '2026-09-02', time: '03:00', qty: 50 })];
  check('logged exactly at a report goes into it; a later one into the next report: 490, 580, 620', eq(rob(sandbox(st), rs), [490, 580, 620]));
  st.receipts = [rcpt({ date: '2026-09-01' })];
  check('an old date-only receipt still counts from the first report of its day: 590, 580, 570', eq(rob(sandbox(st), rs), [590, 580, 570]));
  const sb = sandbox(st);
  st.receipts = [rcpt({ date: '2026-09-01', time: '12:00' })];
  check('the list names the report it goes into', sb.receiptTargetEntry(st.receipts[0]).id === 'e2');
  check('a receipt after the last report goes into none yet', sb.receiptTargetEntry(rcpt({ date: '2026-09-03', time: '01:00' })) === null);
}

console.log('');
if (failures) { console.log(`FAILED — ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASSED — ${checks} checks`);

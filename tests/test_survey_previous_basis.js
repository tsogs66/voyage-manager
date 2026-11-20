#!/usr/bin/env node
/*
 * A bunker survey is made BEFORE the log entry it is attached to, so the surveyor's measured figure is that
 * entry's PREVIOUS R.O.B.; the entry then adds the receipts of its own period (by their logged time) and takes
 * off its consumption, and the result is the next entry's Previous. A late-logged receipt still counts for the
 * entries its time falls in, and the surveyor's figure stays with the entry it was committed on.
 * Surveys saved before this (no basis) keep their old reading: measured = that entry's closing figure.
 * Run: node tests/test_survey_previous_basis.js
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

console.log('\nsource guards');
check('surveyCalculatedBook is the Previous R.O.B. (no consumption taken off)', /function surveyCalculatedBook\([\s\S]{0,900}previous report's closing/.test(HTML)
  && !/function surveyCalculatedBook\([\s\S]{0,1400}deductGradeConsumption/.test(HTML));
check('a new survey is saved with basis "previous"', /basis: 'previous'/.test(HTML));
check('the survey table is headed Previous (book)', HTML.includes('<th>Previous (book)</th>'));
check('status copy: Measured becomes this report\'s Previous, receipts are never overwritten', HTML.includes('it becomes this report\'s Previous R.O.B.') && HTML.includes('Receipts are never overwritten'));
check('every report table takes its Previous from robPreviousForEntry', (HTML.match(/robPreviousForEntry\(entry, priorEntry\)/g) || []).length >= 5);
check('Dep/Arr does not read a Previous-basis measured figure as the present ROB', (HTML.match(/robSurvey\.basis !== 'previous'/g) || []).length >= 2);

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
    'latestRobSurveyAtOrBefore', 'receiptMatchesTankStrict', 'bookReceivedPreferOnce', 'robAsOfComputedRow', 'entryRobReceivedQty',
    'robPreviousForEntry', 'robAsOfEntry'].map(extract).join('\n'), sb);
  return sb;
}
const row = (id, dt, cum) => ({ id, datetime: dt, cumFuel: { HFO: cum, LSFO: 0, 'MDO/MGO': 0, LSMGO: 0 }, cumLube: {} });
const rows3 = () => [row('e1', '2026-09-01T06:00', 10), row('e2', '2026-09-01T18:00', 20), row('e3', '2026-09-02T06:00', 30)];
const ent = (rs, x) => rs.map((r) => Object.assign({ id: r.id, datetime: r.datetime }, (x || {})[r.id] || {}));
const rob = (sb, rs) => rs.map((r) => sb.robAsOfComputedRow(r, rs).rob.hfo);
const eq = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const survey = (m) => ({ basis: 'previous', measured: { hfo: m } });
const rcpt = (o) => Object.assign({ id: 'r', category: 'fuel', tankId: 'hfo', qty: 100 }, o);
const mk = (extra, receipts) => { const rs = rows3(); return { rs, st: { setup: { rob: { hfo: 500 } }, entries: ent(rs, extra), receipts: receipts || [], _rows: rs } }; };

console.log('\nthe measured figure is the entry\'s Previous');
{
  const { rs, st } = mk({}, []);
  check('no survey: 490, 480, 470', eq(rob(sandbox(st), rs), [490, 480, 470]));
}
{
  const { rs, st } = mk({ e2: { robSurvey: survey(485) } });
  const sb = sandbox(st);
  check('measured 485 against a book Previous of 490: 490, then 485 − 10 = 475, then 465', eq(rob(sb, rs), [490, 475, 465]));
  check('the 2nd entry\'s Previous is the measured 485 and the 3rd\'s is its closing 475',
    sb.robPreviousForEntry(st.entries[1], st.entries[0]).rob.hfo === 485 && sb.robPreviousForEntry(st.entries[2], st.entries[1]).rob.hfo === 475);
  check('the first entry is untouched by a later survey', sb.robPreviousForEntry(st.entries[0], null).rob.hfo === 500);
}
{
  const { rs, st } = mk({ e1: { robSurvey: survey(520) } });
  check('a survey before the very first entry replaces the opening figure: 520 − 10, then 500, 490', eq(rob(sandbox(st), rs), [510, 500, 490]));
}

console.log('\nreceipts follow their logged time, with or without a survey');
{
  const { rs, st } = mk({ e2: { robSurvey: survey(485) } }, [rcpt({ date: '2026-09-01', time: '12:00' })]);
  check('a receipt inside the entry\'s own period is added to the measured Previous: 490, 485 + 100 − 10 = 575, 565', eq(rob(sandbox(st), rs), [490, 575, 565]));
}
{
  const { rs, st } = mk({ e2: { robSurvey: survey(485) } }, [rcpt({ date: '2026-09-01', time: '20:00' })]);
  check('a receipt after the surveyed entry joins the next entry: 490, 475, 565', eq(rob(sandbox(st), rs), [490, 475, 565]));
}
{
  const { rs, st } = mk({ e2: { robSurvey: survey(485) } }, [rcpt({ date: '2026-09-01', time: '03:00' })]);
  check('a late-logged receipt timed before the first entry still counts there and is inside the measured figure after it: 590, 475, 465', eq(rob(sandbox(st), rs), [590, 475, 465]));
}
{
  const { rs, st } = mk({}, [rcpt({ date: '2026-09-01', time: '12:00' })]);
  check('without a survey: 490, 580, 570', eq(rob(sandbox(st), rs), [490, 580, 570]));
}

console.log('\nsurveys saved before this keep their reading (measured = the entry\'s closing figure)');
{
  const { rs, st } = mk({ e2: { robSurvey: { measured: { hfo: 470 }, calculated: { hfo: 480 } } } });
  check('older survey: 490, 470, 460', eq(rob(sandbox(st), rs), [490, 470, 460]));
}

console.log('');
if (failures) { console.log(`FAILED — ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASSED — ${checks} checks`);

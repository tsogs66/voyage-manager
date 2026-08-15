#!/usr/bin/env node
/*
 * e-ORB: scenario item maps, weekly 7-day window, ROB side-effects, bunkering print.
 * Run: node tests/test_eorb.js
 */

'use strict';

require('../eorb.js');
const EORB = global.EORB;

const failures = [];
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures.push(label);
}

function checkTrue(label, value) {
  check(label, !!value, true);
}

console.log('\nscenario item numbers exist on that MARPOL code');
EORB.SCENARIOS.forEach(sc => {
  const op = EORB.getOperation(sc.part, sc.code);
  checkTrue(`${sc.id} maps to code ${sc.code}`, !!op);
  const valid = new Set((op && op.items || []).map(i => i.no));
  (sc.items || []).forEach(no => {
    checkTrue(`${sc.id} item ${no} exists on code ${sc.code}`, valid.has(no));
  });
});

console.log('\nroutine weekly scenarios');
const weekly = EORB.getScenario('weekly-sludge-bilge');
check('weekly sludge+bilge opens the inventory wizard', weekly && weekly.wizard, 'weekly');
check('weekly sludge+bilge is Code C', weekly && weekly.code, 'C');
const ows = EORB.getScenario('ows-weekly-test');
check('weekly OWS test is Code I', ows && ows.code, 'I');
checkTrue('weekly OWS test has a remarks preset', !!(ows && ows.presets && ows.presets.remarks));

console.log('\ncorrected failure / accidental / auto-mode maps');
check('OWS failure ticks Code F items', EORB.getScenario('ows-failure').items, ['19', '20', '21']);
check('accidental discharge ticks Code G items', EORB.getScenario('accidental-discharge').items, ['22', '23', '24', '25']);
check('auto overboard is item 16 only', EORB.getScenario('bilge-ows-auto-overboard').items, ['16']);
check('auto transfer is item 17 only', EORB.getScenario('bilge-ows-auto-transfer').items, ['17']);
check('wells-to-tank from-group is bilge wells',
  EORB.getScenario('bilge-well-to-tank').fieldTankGroups.fromTank, 'bilgeWells');

console.log('\nweekly 7-day window — sooner allowed, later not');
check('add 7 days', EORB.addDaysIso('2026-08-01', 7), '2026-08-08');
check('days between', EORB.daysBetweenIso('2026-08-01', '2026-08-08'), 7);
const due = EORB.weeklyDueStatus('2026-08-01', '2026-08-06');
check('not overdue on day 5', due.overdue, false);
check('due by last+7', due.dueBy, '2026-08-08');
check('days left', due.daysLeft, 2);
checkTrue('overdue the day after last+7', EORB.weeklyDueStatus('2026-08-01', '2026-08-09').overdue);
check('sooner than 7 days is accepted', EORB.weeklyInventoryDateError('2026-08-05', '2026-08-01'), null);
check('exactly 7 days is accepted', EORB.weeklyInventoryDateError('2026-08-08', '2026-08-01'), null);
checkTrue('later than 7 days is refused', !!EORB.weeklyInventoryDateError('2026-08-09', '2026-08-01'));
checkTrue('before last weekly is refused', !!EORB.weeklyInventoryDateError('2026-07-31', '2026-08-01'));
check('first inventory has no window', EORB.weeklyInventoryDateError('2026-08-14', null), null);
checkTrue('OWS label is used in the 7-day error',
  String(EORB.weeklyInventoryDateError('2026-08-09', '2026-08-01', 'Weekly 15 ppm / OWS test') || '')
    .indexOf('Weekly 15 ppm / OWS test') !== -1);
checkTrue('due date itself is not overdue (day 7 is allowed)',
  EORB.weeklyDueStatus('2026-08-01', '2026-08-08').overdue === false);
checkTrue('due date itself is dueSoon', EORB.weeklyDueStatus('2026-08-01', '2026-08-08').dueSoon);
checkTrue('warning flag when past 7 days', EORB.weeklyDueStatus('2026-08-01', '2026-08-09').overdue);

console.log('\ndisclaimerAck survives setup rebuild');
const ackOnce = EORB.defaultOrbSetup({ disclaimerAck: true, shipName: 'Test Vessel' });
check('first defaultOrbSetup keeps ack', ackOnce.disclaimerAck, true);
check('second defaultOrbSetup keeps ack', EORB.defaultOrbSetup(ackOnce).disclaimerAck, true);
check('unset ack stays false', EORB.defaultOrbSetup({ shipName: 'X' }).disclaimerAck, false);

console.log('\nweekly OWS test recognition');
checkTrue('scenario id counts as weekly OWS test',
  EORB.isWeeklyOwsTest({ scenarioId: 'ows-weekly-test', code: 'I' }));
checkTrue('weeklyKind counts as weekly OWS test',
  EORB.isWeeklyOwsTest({ weeklyKind: 'ows-test', code: 'I' }));
check('voided OWS test is ignored',
  EORB.isWeeklyOwsTest({ scenarioId: 'ows-weekly-test', voided: true }), false);
check('last OWS date ignores voided',
  EORB.lastMatchingEntryDate([
    { date: '2026-08-01', scenarioId: 'ows-weekly-test' },
    { date: '2026-08-10', scenarioId: 'ows-weekly-test', voided: true }
  ], EORB.isWeeklyOwsTest), '2026-08-01');

const book = [
  { code: 'C', part: 1, date: '2026-08-01', weeklyInventory: true, selectedItems: ['11.1', '11.2', '11.3'] },
  { code: 'H', part: 1, date: '2026-08-03', selectedItems: ['26.1'] },
  { code: 'C', part: 1, date: '2026-08-01', voided: true, weeklyInventory: true }
];
check('last weekly ignores voided', EORB.lastMatchingEntryDate(book, EORB.isWeeklySludgeInventory), '2026-08-01');
checkTrue('C.11 without 12.x counts as weekly inventory',
  EORB.isWeeklySludgeInventory({ code: 'C', selectedItems: ['11.1', '11.2', '11.3'] }));
check('C.12 transfer is not a weekly inventory',
  EORB.isWeeklySludgeInventory({ code: 'C', selectedItems: ['12.2'] }), false);

console.log('\nbunkering print uses total content, not the split string');
const bunkerLines = EORB.buildItemLines(1, 'H', ['26.3'], {
  fuelType: 'VLSFO', fuelQty: 200, fuelTank: 'fo1|fo2', fuelSplit: 'fo1=120, fo2=80', fuelTotal: 350
}, { tanks: { fuel: [
  { id: 'fo1', name: 'FO 1 P', frameNo: 'Fr. 10', capacityM3: 200, robM3: 50 },
  { id: 'fo2', name: 'FO 2 S', frameNo: 'Fr. 10', capacityM3: 200, robM3: 100 }
] } });
const bunkerText = (bunkerLines.find(l => l.itemNo === '26.3') || {}).text || '';
checkTrue('print names the grade and tonnes', bunkerText.indexOf('VLSFO') !== -1 && bunkerText.indexOf('200 t') !== -1);
checkTrue('print does not call the split the tank total', bunkerText.indexOf('total content fo1=120') === -1);
checkTrue('print states total content 350 t', bunkerText.indexOf('total content 350 t') !== -1);

console.log('\nsludge transfer ROB');
const setup = EORB.defaultOrbSetup({
  tanks: {
    sludge: [
      { id: 'sludge1', name: 'Sludge Settling', capacityM3: 5, robM3: 3 },
      { id: 'sludge2', name: 'Sludge Tank', capacityM3: 8, robM3: 1 }
    ]
  }
});
const filled = EORB.autofillOperationValues(setup, 1, 'C', ['12.2'], {
  fromTank: 'sludge1', toTank: 'sludge2', qtyDisposed: 1.5
});
check('source retained auto-fills', filled.values.retained, 1.5);
check('receiving total auto-fills', filled.values.toTotal, 2.5);
EORB.applyOperationRob(setup, 1, 'C', ['12.2'], filled.values);
check('source ROB after transfer', setup.tanks.sludge[0].robM3, 1.5);
check('receiving ROB after transfer', setup.tanks.sludge[1].robM3, 2.5);

console.log('\nweekly inventory builder covers sludge and bilge');
const inv = EORB.buildWeeklyInventory(setup, [
  { id: 'sludge1', group: 'sludge', name: 'Sludge Settling', capacityM3: 5, robM3: 1.5, include: true },
  { id: 'bilge1', group: 'bilge', name: 'Bilge Holding', capacityM3: 10, robM3: 4, include: true }
], {});
check('produces Code C and Code I', inv.entries.map(e => e.code), ['C', 'I']);
checkTrue('C lines include 11.3', inv.entries[0].lines.some(l => l.itemNo === '11.3'));

console.log('\nprint keeps voided lines struck through');
const html = EORB.buildPrintHtml(setup, [
  { date: '2026-08-01', code: 'C', part: 1, lines: [{ itemNo: '11.1', text: 'Sludge Tank' }], officerName: 'A. Ruiz', voided: true, voidReason: 'wrong tank' }
], 'test');
checkTrue('voided row is marked', html.indexOf('orb-voided') !== -1);
checkTrue('voided text is struck', html.indexOf('<s>Sludge Tank</s>') !== -1);
checkTrue('void reason is printed', html.indexOf('VOID') !== -1 && html.indexOf('wrong tank') !== -1);

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);

#!/usr/bin/env node
/*
 * Ship's clock / zone-time: changing zone adjusts the log time by 30 min or 1 h
 * (or any 30-min step) and period hours subtract clocks advanced.
 * Run: node tests/test_clock_change.js
 */

'use strict';

const ShipTime = require('../ship_time.js');

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

console.log('\nzone labels and steps');
check('UTC+0', ShipTime.formatTzOffset(0), 'UTC+00:00');
check('UTC+8', ShipTime.formatTzOffset(480), 'UTC+08:00');
check('UTC+5:30', ShipTime.formatTzOffset(330), 'UTC+05:30');
check('UTC-3:30', ShipTime.formatTzOffset(-210), 'UTC-03:30');
check('clamp +14', ShipTime.clampTzOffsetMin(14 * 60), 14 * 60);
check('clamp beyond +14', ShipTime.clampTzOffsetMin(15 * 60), 14 * 60);
check('clamp below -12', ShipTime.clampTzOffsetMin(-13 * 60), -12 * 60);
checkTrue('options include +30 min steps', ShipTime.tzOffsetOptions().indexOf(30) !== -1);

console.log('\nadjust time when the zone changes');
const plusHour = ShipTime.applyTimezoneChange('2026-08-15T12:00', 0, 60, 0);
check('UTC+0 → UTC+1 advances the clock 1 hour', plusHour.datetime, '2026-08-15T13:00');
check('logged clock change +60', plusHour.clockChangeMin, 60);
check('delta +60', plusHour.deltaMin, 60);

const minus30 = ShipTime.applyTimezoneChange('2026-08-15T12:00', 480, 450, 0);
check('UTC+8 → UTC+7:30 retards 30 min', minus30.datetime, '2026-08-15T11:30');
check('logged clock change −30', minus30.clockChangeMin, -30);

const stacked = ShipTime.applyTimezoneChange(plusHour.datetime, plusHour.tzOffsetMin, 90, plusHour.clockChangeMin);
check('second +30 stacks on the log', stacked.clockChangeMin, 90);
check('time is 13:30 after +1 h then +30 min', stacked.datetime, '2026-08-15T13:30');

const undo = ShipTime.applyTimezoneChange(plusHour.datetime, 60, 0, 60);
check('changing back undoes the time', undo.datetime, '2026-08-15T12:00');
check('changing back clears the log', undo.clockChangeMin, 0);

console.log('\nperiod hours account for the clock change');
check('noon-to-noon no change is 24 h',
  ShipTime.elapsedShipHours('2026-08-14T12:00', '2026-08-15T12:00', 0), 24);
check('noon-to-noon after clocks +1 h is 23 h',
  ShipTime.elapsedShipHours('2026-08-14T12:00', '2026-08-15T12:00', 60), 23);
check('noon-to-noon after clocks −1 h is 25 h',
  ShipTime.elapsedShipHours('2026-08-14T12:00', '2026-08-15T12:00', -60), 25);
check('noon-to-noon after clocks +30 min is 23.5 h',
  ShipTime.elapsedShipHours('2026-08-14T12:00', '2026-08-15T12:00', 30), 23.5);
check('time also moved +1 h and logged +1 h stays 24 h',
  ShipTime.elapsedShipHours('2026-08-14T12:00', '2026-08-15T13:00', 60), 24);
check('15 Aug noon → 16 Aug noon is 24 h',
  ShipTime.elapsedShipHours('2026-08-15T12:00', '2026-08-16T12:00', 0), 24);
check('UTC+8 stored as clock change is ignored (was 16 h)',
  ShipTime.elapsedShipHours('2026-08-15T12:00', '2026-08-16T12:00', 480), 24);
check('ISO Z suffix still reads as civil noon',
  ShipTime.elapsedShipHours('2026-08-15T12:00', '2026-08-16T12:00:00.000Z', 0), 24);
check('sanitize drops a timezone-sized clock change', ShipTime.sanitizeClockChangeMin(480), 0);
check('sanitize keeps a real +1 h', ShipTime.sanitizeClockChangeMin(60), 60);
check('first zone pick is not a clock change',
  ShipTime.shouldRecordClockChange(0, 480, false, false), false);
check('mid-voyage +1 h is a clock change',
  ShipTime.shouldRecordClockChange(480, 540, true, true), true);
check('zone jump larger than 3 h is not a clock change',
  ShipTime.shouldRecordClockChange(0, 480, true, true), false);
const fromBad = ShipTime.applyTimezoneChange('2026-08-16T12:00', 0, 60, 480);
check('real +1 h after a bogus +8 h log starts from 0', fromBad.clockChangeMin, 60);
checkTrue('wording says advanced', ShipTime.formatClockChange(60).indexOf('advanced 1 hour') !== -1);
check('bogus +8 h wording is cleared', ShipTime.formatClockChange(480), 'No clock change this period.');
checkTrue('wording says retarded', ShipTime.formatClockChange(-30).indexOf('retarded 30 min') !== -1);
check('short form', ShipTime.formatClockChangeShort(60), 'clocks +1h');
check('no change is empty short form', ShipTime.formatClockChangeShort(0), '');

console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
